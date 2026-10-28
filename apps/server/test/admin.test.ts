import { topico } from "@lympha/contracts";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registrarRutas } from "../src/main/api.ts";
import { crearConBrokerAdmin, rutasAdmin } from "../src/modules/admin/index.ts";
import { crearAutenticador } from "../src/modules/identidad/index.ts";
import { type BdApp, crearBdApp } from "../src/platform/db.ts";
import { ClienteDynsec } from "../src/platform/dynsec.ts";
import { crearServidorHttp } from "../src/platform/http.ts";
import { crearLogger } from "../src/platform/logger.ts";
import { migrar } from "../src/platform/migrar.ts";
import {
  cerrarCliente,
  crearClienteMqtt,
  esperarConexion,
  type MqttClient,
} from "../src/platform/mqtt.ts";
import { crearValkey, type Redis } from "../src/platform/valkey.ts";
import {
  iniciarMosquitto,
  iniciarPostgres,
  iniciarValkey,
  type MosquittoDePrueba,
  MQTT_PW,
  type PostgresDePrueba,
  type ValkeyDePrueba,
} from "./helpers/contenedores.ts";
import { tokenDe, verificadorDePrueba } from "./helpers/verificador.ts";

/**
 * Panel de administración (migración 0015) contra Postgres, Valkey y Mosquitto reales. Los nombres de las pruebas
 * de acceso cruzado están citados en test/rutas-cubiertas.ts.
 */

const PEPPER = "pepper";
const usuarios = {
  admin: tokenDe("uid-admin", "admin@example.com", "Admina"),
  dueno: tokenDe("uid-dueno", "dueno@example.com", "Dueño"),
  normal: tokenDe("uid-normal", "normal@example.com", "Normal"),
};

let pgc: PostgresDePrueba;
let vk: ValkeyDePrueba;
let mq: MosquittoDePrueba;
let owner: pg.Client;
let adminMqtt: MqttClient;
let app: FastifyInstance;
let bd: BdApp;
let valkey: Redis;

async function llamar(
  token: string | null,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
  appUsada: FastifyInstance = app,
) {
  const r = await appUsada.inject({
    method,
    url,
    ...(token ? { headers: { authorization: token } } : {}),
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return {
    status: r.statusCode,
    cabeceras: r.headers,
    cuerpo: r.body ? (JSON.parse(r.body) as any) : null,
  };
}

async function conecta(deviceId: string, password: string): Promise<boolean> {
  const c = crearClienteMqtt({
    url: mq.url,
    username: deviceId,
    password,
    clientId: deviceId,
    reconnectPeriod: 0,
  });
  try {
    await esperarConexion(c, 5_000);
    await c.publishAsync(topico(deviceId, "telemetry"), "{}", { qos: 1 });
    return true;
  } catch {
    return false;
  } finally {
    c.end(true);
  }
}

/** Todo lo que la base conserva de nodos, lotes y auditoría, como texto. */
async function volcado(): Promise<string> {
  return JSON.stringify([
    (await owner.query("SELECT * FROM app.nodos")).rows,
    (await owner.query("SELECT * FROM app.lotes")).rows,
    (await owner.query("SELECT * FROM app.auditoria")).rows,
  ]);
}

const sinGuiones = (c: string) => c.replaceAll("-", "");

async function crearLote(cantidad: number) {
  const r = await llamar(usuarios.admin, "POST", "/api/admin/lotes", {
    cantidad,
    version_hw: "v1",
  });
  expect(r.status).toBe(201);
  return r.cuerpo as {
    lote_id: string;
    etiquetas: {
      device_id: string;
      codigo_reclamo: string;
      ap_key: string;
      mqtt_password: string;
      svg: string;
    }[];
  };
}

beforeAll(async () => {
  [pgc, vk, mq] = await Promise.all([iniciarPostgres(), iniciarValkey(), iniciarMosquitto()]);
  await migrar(pgc.url("owner"));
  owner = new pg.Client({ connectionString: pgc.url("owner") });
  await owner.connect();

  adminMqtt = crearClienteMqtt({
    url: mq.url,
    username: "lympha-admin",
    password: MQTT_PW.admin,
    clientId: "lympha-admin-prueba-panel",
  });
  await esperarConexion(adminMqtt);
  await new ClienteDynsec(adminMqtt).aplicarBase([
    {
      username: "lympha-ingest",
      password: MQTT_PW.ingest,
      rolename: "ingest",
      clientid: "lympha-ingest",
    },
    { username: "lympha-control", password: MQTT_PW.control, rolename: "control" },
  ]);

  bd = crearBdApp(pgc.url("app"), 5);
  valkey = crearValkey(vk.url("api"), "prueba-admin");
  const log = crearLogger("prueba", "silent");
  app = crearServidorHttp(log);
  await registrarRutas(
    app,
    {
      bd,
      valkey,
      mqtt: { connected: true } as never,
      version: "prueba",
      appEnv: "local",
      verificador: verificadorDePrueba,
      claimPepper: PEPPER,
      conBrokerAdmin: crearConBrokerAdmin({
        url: mq.url,
        usuario: "lympha-admin",
        password: MQTT_PW.admin,
      }),
    },
    log,
  );
  await app.ready();

  // El perfil local existe desde el primer acceso; el alta de admin es solo por base (como el CLI).
  for (const t of Object.values(usuarios)) await llamar(t, "GET", "/api/yo");
  await owner.query(
    "INSERT INTO app.admins_plataforma (usuario_id) SELECT id FROM app.usuarios WHERE email = 'admin@example.com'",
  );
}, 300_000);

afterAll(async () => {
  await app?.close();
  await bd?.cerrar();
  valkey?.disconnect();
  await cerrarCliente(adminMqtt).catch(() => undefined);
  await owner?.end();
  await Promise.all([pgc?.detener(), vk?.detener(), mq?.detener()]);
});

describe("panel de administración", () => {
  it("admin: sin ser admin de plataforma toda ruta responde 404 idéntico", async () => {
    // Un propietario de espacio con un nodo reclamado: tener un espacio no da ningún poder de plataforma.
    const lote = await crearLote(1);
    const espacio = await llamar(usuarios.dueno, "POST", "/api/espacios", {
      nombre: "Casa",
      tipo: "hogar",
    });
    const etiqueta = lote.etiquetas[0];
    if (!etiqueta) throw new Error("falta la etiqueta");
    const nodo = etiqueta.device_id;
    expect(
      (
        await llamar(usuarios.dueno, "POST", "/api/nodos/reclamar", {
          nodoId: nodo,
          codigo: etiqueta.codigo_reclamo,
          espacioId: espacio.cuerpo.id,
        })
      ).status,
    ).toBe(200);

    const inexistente = await llamar(usuarios.dueno, "GET", "/api/admin/no-existe");
    expect(inexistente.status).toBe(404);

    const rutas: [string, string, unknown?][] = [
      ["GET", "/api/admin/lotes"],
      ["POST", "/api/admin/lotes", { cantidad: 1 }],
      ["POST", "/api/admin/lotes", { cantidad: "no" }], // inválido: tampoco delata la ruta
      ["POST", `/api/admin/lotes/${lote.lote_id}/revocar`, { confirmar: true }],
      ["GET", "/api/admin/nodos"],
      ["GET", `/api/admin/nodos/${nodo}`],
      ["GET", `/api/admin/nodos/${nodo}/pertenece-a`],
      ["POST", `/api/admin/nodos/${nodo}/regenerar-etiqueta`],
      ["POST", `/api/admin/nodos/${nodo}/revocar`, { confirmar: true }],
    ];
    const auditoriaAntes = (await owner.query("SELECT count(*)::int AS n FROM app.auditoria"))
      .rows[0].n;
    for (const token of [null, usuarios.normal, usuarios.dueno]) {
      for (const [metodo, url, cuerpo] of rutas) {
        const r = await llamar(token, metodo as "GET" | "POST", url, cuerpo);
        expect(r.status, `${metodo} ${url}`).toBe(404);
        expect(r.cuerpo, `${metodo} ${url}`).toEqual(inexistente.cuerpo);
      }
    }
    // nada de lo anterior hizo efecto ni dejó rastro
    expect((await owner.query("SELECT count(*)::int AS n FROM app.auditoria")).rows[0].n).toBe(
      auditoriaAntes,
    );
    expect(
      (await owner.query("SELECT estado FROM app.nodos WHERE id = $1", [nodo])).rows[0].estado,
    ).toBe("reclamado");

    // el rol no sale de ningún espacio ni se puede dar por la API: es solo de la tabla
    expect((await llamar(usuarios.dueno, "GET", "/api/yo")).cuerpo.es_admin).toBe(false);
    expect((await llamar(usuarios.admin, "GET", "/api/yo")).cuerpo.es_admin).toBe(true);
    await expect(
      bd.pool.query(
        "INSERT INTO app.admins_plataforma (usuario_id) SELECT id FROM app.usuarios LIMIT 1",
      ),
    ).rejects.toThrow();
    await expect(bd.pool.query("SELECT * FROM app.admins_plataforma")).rejects.toThrow();
    // el propio admin ve las rutas
    expect((await llamar(usuarios.admin, "GET", "/api/admin/lotes")).status).toBe(200);
  });

  it("crear un lote entrega las etiquetas una sola vez y en la base solo queda el hash", async () => {
    const lote = await crearLote(2);
    expect(lote.etiquetas).toHaveLength(2);
    const respuesta = await llamar(usuarios.admin, "POST", "/api/admin/lotes", { cantidad: 1 });
    expect(respuesta.cabeceras["cache-control"]).toBe("no-store");

    const base = await volcado();
    for (const e of lote.etiquetas) {
      expect(e.svg).toContain("80mm");
      expect(e.svg).toContain(e.codigo_reclamo);
      expect(base).not.toContain(e.codigo_reclamo);
      expect(base).not.toContain(sinGuiones(e.codigo_reclamo));
      expect(base).not.toContain(e.mqtt_password);
      expect(base).not.toContain(e.ap_key);
      // el broker acepta la credencial entregada y solo esa
      expect(await conecta(e.device_id, e.mqtt_password)).toBe(true);
      expect(await conecta(e.device_id, "otra-contraseña")).toBe(false);
    }
    const [a, b] = lote.etiquetas;
    if (!a || !b) throw new Error("faltan etiquetas");
    expect(await conecta(a.device_id, b.mqtt_password)).toBe(false);

    const filas = await owner.query(
      "SELECT estado, espacio_id, length(claim_hash) AS largo FROM app.nodos WHERE lote_id = $1",
      [lote.lote_id],
    );
    for (const f of filas.rows)
      expect(f).toMatchObject({ estado: "fabricado", espacio_id: null, largo: 32 });
    const aud = await owner.query(
      "SELECT actor_tipo, actor_id, detalle FROM app.auditoria WHERE accion = 'lote.fabricado' AND detalle->>'lote_id' = $1",
      [lote.lote_id],
    );
    expect(aud.rows).toHaveLength(1);
    expect(aud.rows[0].actor_tipo).toBe("soporte");
    expect(aud.rows[0].actor_id).not.toBeNull();

    // cantidades fuera de rango y campos desconocidos: 400
    for (const cuerpo of [{ cantidad: 0 }, { cantidad: 51 }, { cantidad: 1, extra: 1 }]) {
      expect((await llamar(usuarios.admin, "POST", "/api/admin/lotes", cuerpo)).status).toBe(400);
    }
  });

  it("cada consulta de «pertenece a» deja auditoría y no expone datos de agua", async () => {
    const lote = await crearLote(2);
    const [reclamado, libre] = lote.etiquetas;
    if (!reclamado || !libre) throw new Error("faltan etiquetas");
    const espacio = await llamar(usuarios.dueno, "POST", "/api/espacios", {
      nombre: "Oficina",
      tipo: "pyme",
    });
    await llamar(usuarios.dueno, "POST", "/api/nodos/reclamar", {
      nodoId: reclamado.device_id,
      codigo: reclamado.codigo_reclamo,
      espacioId: espacio.cuerpo.id,
    });
    await owner.query(
      `INSERT INTO ts.lecturas (nodo_id, espacio_id, ts, seq, ph) VALUES ($1, $2, now(), 1, 7.1)`,
      [reclamado.device_id, espacio.cuerpo.id],
    );

    const contar = async () =>
      (
        await owner.query(
          "SELECT count(*)::int AS n FROM app.auditoria WHERE accion = 'soporte.acceso' AND nodo_id = $1",
          [reclamado.device_id],
        )
      ).rows[0].n as number;

    // el detalle (estado y lote) no identifica a nadie y no audita
    const detalle = await llamar(usuarios.admin, "GET", `/api/admin/nodos/${reclamado.device_id}`);
    expect(detalle.status).toBe(200);
    expect(detalle.cuerpo).toMatchObject({
      estado: "reclamado",
      asignado: true,
      lote: { id: lote.lote_id },
    });
    expect(JSON.stringify(detalle.cuerpo)).not.toContain("dueno@example.com");
    expect(await contar()).toBe(0);

    for (let i = 1; i <= 2; i++) {
      const r = await llamar(
        usuarios.admin,
        "GET",
        `/api/admin/nodos/${reclamado.device_id}/pertenece-a`,
      );
      expect(r.status).toBe(200);
      expect(r.cuerpo).toMatchObject({
        espacio_nombre: "Oficina",
        propietario_email: "dueno@example.com",
        propietario_nombre: "Dueño",
      });
      expect(r.cabeceras["cache-control"]).toBe("no-store");
      // ni lecturas, ni WQI, ni alarmas
      const claves = Object.keys(r.cuerpo).join(",");
      expect(claves).not.toMatch(/ph|lectura|wqi|alarma|nivel/);
      expect(await contar()).toBe(i);
    }
    const aud = await owner.query(
      "SELECT actor_tipo, actor_id, espacio_id, detalle FROM app.auditoria WHERE accion = 'soporte.acceso' AND nodo_id = $1",
      [reclamado.device_id],
    );
    for (const f of aud.rows) {
      expect(f.actor_tipo).toBe("soporte");
      expect(f.espacio_id).toBe(espacio.cuerpo.id);
      expect(JSON.stringify(f)).not.toContain("example.com"); // ids, nunca correos
    }

    // un nodo sin dueño también se audita; uno inexistente es 404 y no deja fila
    const sin = await llamar(
      usuarios.admin,
      "GET",
      `/api/admin/nodos/${libre.device_id}/pertenece-a`,
    );
    expect(sin.status).toBe(200);
    expect(sin.cuerpo).toMatchObject({ espacio_id: null, propietario_email: null });
    const antes = (await owner.query("SELECT count(*)::int AS n FROM app.auditoria")).rows[0].n;
    const nada = await llamar(
      usuarios.admin,
      "GET",
      "/api/admin/nodos/0192f3a7-0000-7000-8000-0000000000ee/pertenece-a",
    );
    expect(nada.status).toBe(404);
    expect((await owner.query("SELECT count(*)::int AS n FROM app.auditoria")).rows[0].n).toBe(
      antes,
    );
  });

  it("regenerar invalida el código anterior y solo aplica a nodos sin reclamar", async () => {
    const lote = await crearLote(2);
    const [a, b] = lote.etiquetas;
    if (!a || !b) throw new Error("faltan etiquetas");
    const espacio = await llamar(usuarios.dueno, "POST", "/api/espacios", {
      nombre: "Taller",
      tipo: "pyme",
    });
    const reclamar = (n: { device_id: string }, codigo: string) =>
      llamar(usuarios.dueno, "POST", "/api/nodos/reclamar", {
        nodoId: n.device_id,
        codigo,
        espacioId: espacio.cuerpo.id,
      });

    const r = await llamar(
      usuarios.admin,
      "POST",
      `/api/admin/nodos/${a.device_id}/regenerar-etiqueta`,
    );
    expect(r.status).toBe(200);
    expect(r.cabeceras["cache-control"]).toBe("no-store");
    const nueva = r.cuerpo.etiqueta;
    expect(nueva.device_id).toBe(a.device_id);
    expect(nueva.codigo_reclamo).not.toBe(a.codigo_reclamo);
    expect(nueva.svg).toContain(nueva.codigo_reclamo);

    expect((await reclamar(a, a.codigo_reclamo)).status).toBe(404); // el código viejo ya no sirve
    // credenciales: la contraseña vieja del broker deja de servir y la nueva sí
    expect(await conecta(a.device_id, a.mqtt_password)).toBe(false);
    expect(await conecta(a.device_id, nueva.mqtt_password)).toBe(true);
    // el otro nodo del lote no se tocó
    expect(await conecta(b.device_id, b.mqtt_password)).toBe(true);

    const base = await volcado();
    for (const secreto of [
      nueva.codigo_reclamo,
      sinGuiones(nueva.codigo_reclamo),
      nueva.mqtt_password,
      nueva.ap_key,
    ]) {
      expect(base).not.toContain(secreto);
    }
    expect(
      (
        await owner.query(
          "SELECT actor_tipo FROM app.auditoria WHERE accion = 'nodo.etiqueta_regenerada' AND nodo_id = $1",
          [a.device_id],
        )
      ).rows,
    ).toEqual([{ actor_tipo: "soporte" }]);

    expect((await reclamar(a, nueva.codigo_reclamo)).status).toBe(200); // el nuevo sí reclama
    // ya reclamado: no se regenera (se desvincula primero)
    const otra = await llamar(
      usuarios.admin,
      "POST",
      `/api/admin/nodos/${a.device_id}/regenerar-etiqueta`,
    );
    expect(otra.status).toBe(409);
    expect(otra.cuerpo.codigo).toBe("regeneracion_invalida");
    expect(await conecta(a.device_id, nueva.mqtt_password)).toBe(true); // el 409 no tocó el broker
    expect(
      (
        await llamar(
          usuarios.admin,
          "POST",
          "/api/admin/nodos/0192f3a7-0000-7000-8000-0000000000ee/regenerar-etiqueta",
        )
      ).status,
    ).toBe(404);
  });

  it("revocar un nodo o un lote pide confirmación, cierra el broker y queda auditado", async () => {
    const lote = await crearLote(3);
    const [a, b, c] = lote.etiquetas;
    if (!a || !b || !c) throw new Error("faltan etiquetas");

    const sin = await llamar(usuarios.admin, "POST", `/api/admin/nodos/${a.device_id}/revocar`);
    expect(sin.status).toBe(400);
    const mal = await llamar(usuarios.admin, "POST", `/api/admin/nodos/${a.device_id}/revocar`, {
      confirmar: false,
    });
    expect(mal.status).toBe(400);
    expect(await conecta(a.device_id, a.mqtt_password)).toBe(true);

    const uno = await llamar(usuarios.admin, "POST", `/api/admin/nodos/${a.device_id}/revocar`, {
      confirmar: true,
    });
    expect(uno.status).toBe(204);
    expect(await conecta(a.device_id, a.mqtt_password)).toBe(false);
    expect(await conecta(b.device_id, b.mqtt_password)).toBe(true);
    // repetir es seguro y no duplica la auditoría
    expect(
      (
        await llamar(usuarios.admin, "POST", `/api/admin/nodos/${a.device_id}/revocar`, {
          confirmar: true,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await owner.query(
          "SELECT count(*)::int AS n FROM app.auditoria WHERE accion = 'nodo.revocado' AND nodo_id = $1",
          [a.device_id],
        )
      ).rows[0].n,
    ).toBe(1);

    expect(
      (await llamar(usuarios.admin, "POST", `/api/admin/lotes/${lote.lote_id}/revocar`, {})).status,
    ).toBe(400);
    const todo = await llamar(usuarios.admin, "POST", `/api/admin/lotes/${lote.lote_id}/revocar`, {
      confirmar: true,
    });
    expect(todo.status).toBe(200);
    expect(todo.cuerpo.nodos_revocados).toBe(2); // el primero ya estaba revocado
    for (const n of [a, b, c]) expect(await conecta(n.device_id, n.mqtt_password)).toBe(false);
    expect(
      (
        await owner.query("SELECT DISTINCT estado FROM app.nodos WHERE lote_id = $1", [
          lote.lote_id,
        ])
      ).rows,
    ).toEqual([{ estado: "revocado" }]);
    expect(
      (await owner.query("SELECT revocado_en FROM app.lotes WHERE id = $1", [lote.lote_id])).rows[0]
        .revocado_en,
    ).not.toBeNull();
    expect(
      (
        await owner.query(
          "SELECT actor_tipo FROM app.auditoria WHERE accion = 'lote.revocado' AND detalle->>'lote_id' = $1",
          [lote.lote_id],
        )
      ).rows,
    ).toEqual([{ actor_tipo: "soporte" }]);
    // un lote revocado no se reclama
    expect(
      (
        await llamar(
          usuarios.admin,
          "POST",
          `/api/admin/lotes/0192f3a7-0000-7000-8000-0000000000ee/revocar`,
          { confirmar: true },
        )
      ).status,
    ).toBe(404);
  });

  it("lista lotes y nodos con filtros y paginación, sin identificar a nadie", async () => {
    const lote = await crearLote(3);
    const lotes = await llamar(usuarios.admin, "GET", "/api/admin/lotes");
    const mio = lotes.cuerpo.lotes.find((l: { id: string }) => l.id === lote.lote_id);
    expect(mio).toMatchObject({ cantidad: 3, nodos: { fabricado: 3, revocado: 0 } });

    const todos = await llamar(usuarios.admin, "GET", `/api/admin/nodos?lote=${lote.lote_id}`);
    expect(todos.cuerpo.total).toBe(3);
    expect(todos.cuerpo.nodos).toHaveLength(3);
    const pagina = await llamar(
      usuarios.admin,
      "GET",
      `/api/admin/nodos?lote=${lote.lote_id}&limite=2&desplazamiento=2`,
    );
    expect(pagina.cuerpo).toMatchObject({ total: 3 });
    expect(pagina.cuerpo.nodos).toHaveLength(1);

    const id = lote.etiquetas[0]?.device_id ?? "";
    const buscado = await llamar(
      usuarios.admin,
      "GET",
      `/api/admin/nodos?q=${id.slice(-8).toUpperCase()}`,
    );
    expect(buscado.cuerpo.nodos.map((n: { id: string }) => n.id)).toContain(id);
    const revocados = await llamar(
      usuarios.admin,
      "GET",
      `/api/admin/nodos?lote=${lote.lote_id}&estado=revocado`,
    );
    expect(revocados.cuerpo).toEqual({ nodos: [], total: 0 });
    expect((await llamar(usuarios.admin, "GET", "/api/admin/nodos?estado=raro")).status).toBe(400);
    expect((await llamar(usuarios.admin, "GET", "/api/admin/nodos?otra=1")).status).toBe(400);
    expect(JSON.stringify(todos.cuerpo)).not.toContain("@");
  });

  it("sin credencial de administración del broker, las acciones que lo tocan responden 503 y no cambian nada", async () => {
    const lote = await crearLote(1);
    const id = lote.etiquetas[0]?.device_id ?? "";
    const log = crearLogger("prueba", "silent");
    const sinBroker = crearServidorHttp(log);
    await sinBroker.register(rutasAdmin, {
      bd,
      autenticar: crearAutenticador(verificadorDePrueba, bd),
      claimPepper: PEPPER,
    });
    await sinBroker.ready();
    try {
      for (const [url, cuerpo] of [
        ["/api/admin/lotes", { cantidad: 1 }],
        [`/api/admin/nodos/${id}/revocar`, { confirmar: true }],
        [`/api/admin/nodos/${id}/regenerar-etiqueta`, undefined],
        [`/api/admin/lotes/${lote.lote_id}/revocar`, { confirmar: true }],
      ] as const) {
        expect((await llamar(usuarios.admin, "POST", url, cuerpo, sinBroker)).status, url).toBe(
          503,
        );
      }
      expect(
        (await owner.query("SELECT estado FROM app.nodos WHERE id = $1", [id])).rows[0].estado,
      ).toBe("fabricado");
      // lo que solo lee, sigue funcionando
      expect(
        (await llamar(usuarios.admin, "GET", "/api/admin/lotes", undefined, sinBroker)).status,
      ).toBe(200);
    } finally {
      await sinBroker.close();
    }
  });
});
