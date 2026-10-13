import { topico } from "@lympha/contracts";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registrarRutas } from "../src/main/api.ts";
import { fabricarLote, revocarLote, revocarNodo } from "../src/modules/fabrica/index.ts";
import { crearBdApp } from "../src/platform/db.ts";
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
import { crearValkey } from "../src/platform/valkey.ts";
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

const PEPPER = "pepper";

let pgc: PostgresDePrueba;
let vk: ValkeyDePrueba;
let mq: MosquittoDePrueba;
let owner: pg.Client;
let admin: MqttClient;
let dynsec: ClienteDynsec;

/** Intenta conectar como nodo; resuelve `true` si el broker lo acepta. */
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
    return true;
  } catch {
    return false;
  } finally {
    c.end(true);
  }
}

/** Conecta y trata de publicar en su propio tópico: `true` si el broker lo permite. */
async function publica(deviceId: string, password: string): Promise<boolean> {
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

beforeAll(async () => {
  [pgc, vk, mq] = await Promise.all([iniciarPostgres(), iniciarValkey(), iniciarMosquitto()]);
  await migrar(pgc.url("owner"));
  owner = new pg.Client({ connectionString: pgc.url("owner") });
  await owner.connect();

  admin = crearClienteMqtt({
    url: mq.url,
    username: "lympha-admin",
    password: MQTT_PW.admin,
    clientId: "lympha-admin-fabrica",
  });
  await esperarConexion(admin);
  dynsec = new ClienteDynsec(admin);
  await dynsec.aplicarBase([
    {
      username: "lympha-ingest",
      password: MQTT_PW.ingest,
      rolename: "ingest",
      clientid: "lympha-ingest",
    },
    { username: "lympha-control", password: MQTT_PW.control, rolename: "control" },
  ]);
}, 300_000);

afterAll(async () => {
  await cerrarCliente(admin).catch(() => undefined);
  await owner?.end();
  await Promise.all([pgc?.detener(), vk?.detener(), mq?.detener()]);
});

describe("CLI de fábrica", () => {
  it("fabrica un lote: solo el hash en Postgres, un cliente por nodo en el broker, y el código reclama el nodo", async () => {
    const deps = { db: owner, dynsec, claimPepper: PEPPER };
    const lote = await fabricarLote(deps, { cantidad: 3, versionHw: "v1", notas: "prueba" });
    expect(lote.nodos).toHaveLength(3);
    expect(new Set(lote.nodos.map((n) => n.deviceId)).size).toBe(3);

    // Postgres: nodos "fabricado" sin espacio, con hash; ni contraseñas ni códigos en claro en ninguna tabla
    const filas = await owner.query(
      "SELECT id, estado, espacio_id, length(claim_hash) AS largo FROM app.nodos WHERE lote_id = $1",
      [lote.loteId],
    );
    expect(filas.rowCount).toBe(3);
    for (const f of filas.rows)
      expect(f).toMatchObject({ estado: "fabricado", espacio_id: null, largo: 32 });
    const volcado = JSON.stringify([
      (await owner.query("SELECT * FROM app.nodos")).rows,
      (await owner.query("SELECT * FROM app.lotes")).rows,
      (await owner.query("SELECT * FROM app.auditoria")).rows,
    ]);
    for (const n of lote.nodos) {
      expect(volcado).not.toContain(n.mqttPassword);
      expect(volcado).not.toContain(n.codigoReclamo);
      expect(volcado).not.toContain(n.codigoReclamo.replaceAll("-", ""));
    }
    expect(
      (await owner.query("SELECT accion FROM app.auditoria WHERE actor_tipo='fabrica'")).rows,
    ).toEqual([{ accion: "lote.fabricado" }]);

    // Broker: cada nodo entra con su contraseña, no con la de otro, y solo publica en su tópico
    const [a, b] = lote.nodos;
    if (!a || !b) throw new Error("faltan nodos");
    expect(await conecta(a.deviceId, a.mqttPassword)).toBe(true);
    expect(await conecta(a.deviceId, b.mqttPassword)).toBe(false);
    const sesion = crearClienteMqtt({
      url: mq.url,
      username: a.deviceId,
      password: a.mqttPassword,
      clientId: a.deviceId,
    });
    await esperarConexion(sesion);
    await expect(
      sesion.publishAsync(topico(b.deviceId, "telemetry"), "{}", { qos: 1 }),
    ).rejects.toThrow(/authorized/i);
    await cerrarCliente(sesion);

    // El código de la etiqueta reclama el nodo por la API real (en minúsculas y con guiones, como se teclea)
    const bd = crearBdApp(pgc.url("app"), 3);
    const valkey = crearValkey(vk.url("api"), "prueba-fabrica");
    const log = crearLogger("prueba", "silent");
    const app = crearServidorHttp(log);
    await registrarRutas(
      app,
      {
        bd,
        valkey,
        mqtt: { connected: true } as never,
        version: "t",
        appEnv: "local",
        verificador: verificadorDePrueba,
        claimPepper: PEPPER,
      },
      log,
    );
    try {
      const t = tokenDe("uid-fab", "fab@example.com");
      const espacio = await app.inject({
        method: "POST",
        url: "/api/espacios",
        headers: { authorization: t },
        payload: { nombre: "Casa", tipo: "hogar" },
      });
      const r = await app.inject({
        method: "POST",
        url: "/api/nodos/reclamar",
        headers: { authorization: t },
        payload: {
          nodoId: a.deviceId,
          codigo: a.codigoReclamo.toLowerCase(),
          espacioId: espacio.json().id,
        },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json().estado).toBe("reclamado");
    } finally {
      await app.close();
      await bd.cerrar();
      valkey.disconnect();
    }
  });

  it("revocar un nodo lo saca del broker y de su espacio", async () => {
    const deps = { db: owner, dynsec, claimPepper: PEPPER };
    const lote = await fabricarLote(deps, { cantidad: 2, versionHw: "v1" });
    const [n, otro] = lote.nodos;
    if (!n || !otro) throw new Error("faltan nodos");
    expect(await conecta(n.deviceId, n.mqttPassword)).toBe(true);
    await revocarNodo(deps, n.deviceId);
    expect(await conecta(n.deviceId, n.mqttPassword)).toBe(false);
    expect(await conecta(otro.deviceId, otro.mqttPassword)).toBe(true); // el vecino sigue
    const fila = (
      await owner.query("SELECT estado, espacio_id FROM app.nodos WHERE id = $1", [n.deviceId])
    ).rows[0];
    expect(fila).toEqual({ estado: "revocado", espacio_id: null });
    await expect(revocarNodo(deps, "0192f3a7-0000-7000-8000-0000000000ee")).rejects.toThrow(
      /no existe/,
    );
  });

  it("revocar un lote niega a todos sus nodos y bloquea el reclamo", async () => {
    const deps = { db: owner, dynsec, claimPepper: PEPPER };
    const lote = await fabricarLote(deps, { cantidad: 3, versionHw: "v1" });
    for (const n of lote.nodos) expect(await publica(n.deviceId, n.mqttPassword)).toBe(true);
    expect(await revocarLote(deps, lote.loteId)).toBe(3);
    for (const n of lote.nodos) expect(await publica(n.deviceId, n.mqttPassword)).toBe(false);
    const r = await owner.query(
      "SELECT count(*) n FROM app.nodos WHERE lote_id = $1 AND estado = 'revocado'",
      [lote.loteId],
    );
    expect(Number(r.rows[0].n)).toBe(3);
    // revocar dos veces no falla
    expect(await revocarLote(deps, lote.loteId)).toBe(0);
    await expect(revocarLote(deps, "0192f3a7-0000-7000-8000-0000000000ee")).rejects.toThrow();
  });

  it("con --dev deja los nodos reclamados en el espacio indicado, listos para el simulador", async () => {
    const espacio = "0192f3a7-0000-7000-8000-0000000d0002";
    await owner.query("INSERT INTO app.espacios (id, nombre, tipo) VALUES ($1, 'Dev', 'hogar')", [
      espacio,
    ]);
    const lote = await fabricarLote(
      { db: owner, dynsec, claimPepper: PEPPER },
      { cantidad: 2, versionHw: "sim", reclamarEn: espacio },
    );
    const r = await owner.query(
      `SELECT n.estado, n.espacio_id, e.espacio_id AS espacio_estado FROM app.nodos n
       JOIN app.estado_nodo e ON e.nodo_id = n.id WHERE n.lote_id = $1`,
      [lote.loteId],
    );
    expect(r.rows).toEqual([
      { estado: "reclamado", espacio_id: espacio, espacio_estado: espacio },
      { estado: "reclamado", espacio_id: espacio, espacio_estado: espacio },
    ]);
  });

  it("si Dynamic Security rechaza un alta, no queda nada a medias en Postgres", async () => {
    const antes = Number((await owner.query("SELECT count(*) n FROM app.lotes")).rows[0].n);
    const roto = {
      db: owner,
      claimPepper: PEPPER,
      dynsec: Object.assign(Object.create(dynsec) as ClienteDynsec, {
        ejecutar: (c: Parameters<ClienteDynsec["ejecutar"]>[0], ms?: number) =>
          c[0]?.command === "createClient"
            ? Promise.resolve([{ command: "createClient", error: "boom" }])
            : dynsec.ejecutar(c, ms),
      }),
    };
    await expect(fabricarLote(roto, { cantidad: 2, versionHw: "v1" })).rejects.toThrow(
      /rechazó un alta/,
    );
    expect(Number((await owner.query("SELECT count(*) n FROM app.lotes")).rows[0].n)).toBe(antes);
  });

  it("valida la cantidad", async () => {
    const deps = { db: owner, dynsec, claimPepper: PEPPER };
    for (const cantidad of [0, -1, 1.5, 100_000]) {
      await expect(fabricarLote(deps, { cantidad, versionHw: "v1" })).rejects.toThrow(RangeError);
    }
  });
});
