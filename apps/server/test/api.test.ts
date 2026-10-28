import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registrarRutas } from "../src/main/api.ts";
import { calibrarFilas, crearCacheCalibracion } from "../src/modules/calibracion/index.ts";
import { crearManejadorTelegram } from "../src/modules/notificaciones/index.ts";
import { guardarLecturas, type LecturaTrabajo } from "../src/modules/telemetria/index.ts";
import { type BdApp, crearBdApp, crearBdSistema } from "../src/platform/db.ts";
import { crearServidorHttp } from "../src/platform/http.ts";
import { crearLogger } from "../src/platform/logger.ts";
import { migrar } from "../src/platform/migrar.ts";
import { crearValkey, type Redis } from "../src/platform/valkey.ts";
import {
  iniciarPostgres,
  iniciarValkey,
  type PostgresDePrueba,
  type ValkeyDePrueba,
} from "./helpers/contenedores.ts";
import { tokenDe, verificadorDePrueba } from "./helpers/verificador.ts";
import { RUTAS_CUBIERTAS } from "./rutas-cubiertas.ts";

/**
 * API de H1 contra Postgres y Valkey reales: identidad, espacios, membresías, invitaciones, reclamo de
 * nodos y eliminación de cuenta. Los nombres de las pruebas de acceso cruzado están citados en
 * test/rutas-cubiertas.ts; la última prueba de este archivo comprueba que existan.
 */

const PEPPER = "pepper";
const LOTE = "0192f3a7-0000-7000-8000-0000000000f1";
const nodoN = (n: number) => `0192f3a7-0000-7000-8000-0000000d${n.toString(16).padStart(4, "0")}`;
const codigoN = (n: number) => `CODIGO${String(n).padStart(6, "2")}`; // 12 caracteres, sin ambiguos
const INEXISTENTE = "0192f3a7-0000-7000-8000-0000000000ee";

let pgc: PostgresDePrueba;
let vk: ValkeyDePrueba;
let owner: pg.Client;
let app: FastifyInstance;
let valkeyApi: Redis;
let bdApp: BdApp;
let bdCerrar: () => Promise<void>;

const usuarios = {
  ana: tokenDe("uid-ana", "ana@example.com", "Ana"),
  beto: tokenDe("uid-beto", "beto@example.com", "Beto"),
  carla: tokenDe("uid-carla", "carla@example.com", "Carla"),
  dani: tokenDe("uid-dani", "dani@example.com", "Dani"),
};

async function llamar(
  token: string | null,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
) {
  const r = await app.inject({
    method,
    url,
    ...(token ? { headers: { authorization: token } } : {}),
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  const texto = r.body;
  return { status: r.statusCode, cuerpo: texto ? (JSON.parse(texto) as any) : null };
}

/** Un nodo fabricado, listo para reclamar con `codigoN(n)`. */
async function fabricarNodo(n: number) {
  await owner.query(
    `INSERT INTO app.nodos (id, lote_id, estado, claim_hash)
     VALUES ($1, $2, 'fabricado', digest($3::text || $4::text, 'sha256'))`,
    [nodoN(n), LOTE, codigoN(n), PEPPER],
  );
  return nodoN(n);
}

async function crearEspacio(token: string, nombre = "Casa") {
  const r = await llamar(token, "POST", "/api/espacios", { nombre, tipo: "hogar" });
  expect(r.status).toBe(201);
  return r.cuerpo.id as string;
}

/** Hace miembro de `espacio` a quien tenga `tokenMiembro`, por el camino real (invitación). */
async function invitar(tokenPropietario: string, espacio: string, tokenMiembro: string) {
  const inv = await llamar(tokenPropietario, "POST", `/api/espacios/${espacio}/invitaciones`);
  expect(inv.status).toBe(201);
  const acept = await llamar(tokenMiembro, "POST", "/api/invitaciones/aceptar", {
    token: inv.cuerpo.token,
  });
  expect(acept.status).toBe(200);
}

const usuarioId = async (token: string) =>
  (await llamar(token, "GET", "/api/yo")).cuerpo.id as string;

beforeAll(async () => {
  [pgc, vk] = await Promise.all([iniciarPostgres(), iniciarValkey()]);
  await migrar(pgc.url("owner"));
  owner = new pg.Client({ connectionString: pgc.url("owner") });
  await owner.connect();
  await owner.query("INSERT INTO app.lotes (id, cantidad, version_hw) VALUES ($1, 50, 'v1')", [
    LOTE,
  ]);

  const bd = crearBdApp(pgc.url("app"), 5);
  bdApp = bd;
  valkeyApi = crearValkey(vk.url("api"), "prueba-api");
  const log = crearLogger("prueba", "silent");
  app = crearServidorHttp(log);
  await registrarRutas(
    app,
    {
      bd,
      valkey: valkeyApi,
      mqtt: { connected: true } as never,
      version: "prueba",
      appEnv: "local",
      verificador: verificadorDePrueba,
      claimPepper: PEPPER,
      nombreBot: async () => "lympha_prueba_bot",
    },
    log,
  );
  await app.ready();
  bdCerrar = () => bd.cerrar();
}, 300_000);

afterAll(async () => {
  await app?.close();
  await bdCerrar?.();
  valkeyApi?.disconnect();
  await owner?.end();
  await Promise.all([pgc?.detener(), vk?.detener()]);
});

describe("API de H1", () => {
  it("identidad: cada token ve solo su propio perfil", async () => {
    const ana = await llamar(usuarios.ana, "GET", "/api/yo");
    const beto = await llamar(usuarios.beto, "GET", "/api/yo");
    expect(ana.status).toBe(200);
    expect(ana.cuerpo).toMatchObject({ email: "ana@example.com", nombre: "Ana" });
    expect(beto.cuerpo).toMatchObject({ email: "beto@example.com" });
    expect(ana.cuerpo.id).not.toBe(beto.cuerpo.id);

    // sin token, con token roto o con un esquema que no es Bearer: 401, siempre igual
    for (const t of [null, "Bearer ", "Bearer sin-formato", "Basic abc"]) {
      const r = await llamar(t, "GET", "/api/yo");
      expect(r.status).toBe(401);
      expect(r.cuerpo).toEqual({ codigo: "no_autenticado", mensaje: "Autenticación requerida" });
    }

    // el perfil se crea en el primer uso y es idempotente
    const otraVez = await llamar(usuarios.ana, "GET", "/api/yo");
    expect(otraVez.cuerpo.id).toBe(ana.cuerpo.id);
    expect(
      Number(
        (await owner.query("SELECT count(*) n FROM app.usuarios WHERE auth_uid='uid-ana'")).rows[0]
          .n,
      ),
    ).toBe(1);

    // el nombre se puede cambiar; el correo y cualquier campo desconocido no
    expect(
      (await llamar(usuarios.ana, "PATCH", "/api/yo", { nombre: "Ana María" })).cuerpo.nombre,
    ).toBe("Ana María");
    expect((await llamar(usuarios.ana, "PATCH", "/api/yo", { email: "otro@x.com" })).status).toBe(
      400,
    );
    expect((await llamar(usuarios.beto, "GET", "/api/yo")).cuerpo.nombre).toBe("Beto");
  });

  it("crear espacio: el límite es por usuario", async () => {
    const t = tokenDe("uid-limite", "limite@example.com");
    for (let i = 0; i < 10; i++) await crearEspacio(t, `Espacio ${i}`);
    const r = await llamar(t, "POST", "/api/espacios", { nombre: "Uno más", tipo: "hogar" });
    expect(r.status).toBe(409);
    expect(r.cuerpo.codigo).toBe("limite_espacios");
    // el límite de uno no afecta a otro
    expect(
      (await llamar(usuarios.dani, "POST", "/api/espacios", { nombre: "Mío", tipo: "pyme" }))
        .status,
    ).toBe(201);
    // validación del cuerpo
    for (const malo of [
      { nombre: "", tipo: "hogar" },
      { nombre: "x", tipo: "castillo" },
      { nombre: "x", tipo: "hogar", extra: 1 },
    ]) {
      expect((await llamar(usuarios.dani, "POST", "/api/espacios", malo)).status).toBe(400);
    }
  });

  it("un usuario solo lista sus espacios", async () => {
    const ana = await crearEspacio(usuarios.ana, "Casa de Ana");
    const beto = await crearEspacio(usuarios.beto, "Casa de Beto");
    const deAna = (await llamar(usuarios.ana, "GET", "/api/espacios")).cuerpo.espacios as {
      id: string;
      rol: string;
    }[];
    const deBeto = (await llamar(usuarios.beto, "GET", "/api/espacios")).cuerpo.espacios as {
      id: string;
    }[];
    expect(deAna.map((e) => e.id)).toContain(ana);
    expect(deAna.map((e) => e.id)).not.toContain(beto);
    expect(deBeto.map((e) => e.id)).toContain(beto);
    expect(deBeto.map((e) => e.id)).not.toContain(ana);
    expect(deAna.find((e) => e.id === ana)?.rol).toBe("propietario");
  });

  it("un usuario ajeno recibe 404 en el espacio, sus miembros y sus nodos", async () => {
    const espacio = await crearEspacio(usuarios.ana, "Privado");
    await invitar(usuarios.ana, espacio, usuarios.carla);
    const nodo = await fabricarNodo(1);
    await llamar(usuarios.ana, "POST", "/api/nodos/reclamar", {
      nodoId: nodo,
      codigo: codigoN(1),
      espacioId: espacio,
    });

    const propio = await llamar(usuarios.ana, "GET", `/api/espacios/${espacio}`);
    expect(propio.status).toBe(200);
    expect(propio.cuerpo.miembros.map((m: { nombre: string }) => m.nombre).sort()).toEqual([
      "Ana María",
      "Carla",
    ]);
    expect(propio.cuerpo.nodos.map((n: { id: string }) => n.id)).toEqual([nodo]);
    // los demás miembros se ven por nombre; nunca por correo
    expect(JSON.stringify(propio.cuerpo)).not.toContain("example.com");

    const ajeno = await llamar(usuarios.beto, "GET", `/api/espacios/${espacio}`);
    const inexistente = await llamar(usuarios.beto, "GET", `/api/espacios/${INEXISTENTE}`);
    expect(ajeno.status).toBe(404);
    expect(ajeno.cuerpo).toEqual(inexistente.cuerpo); // no se revela si el espacio existe
    expect(JSON.stringify(ajeno.cuerpo)).not.toContain(nodo);
    // un miembro sí lo ve
    expect((await llamar(usuarios.carla, "GET", `/api/espacios/${espacio}`)).status).toBe(200);

    // el stream SSE del espacio (H2) responde igual: 404 al ajeno, indistinguible de un espacio inexistente
    const sseAjeno = await llamar(usuarios.beto, "GET", `/api/espacios/${espacio}/eventos`);
    const sseInexistente = await llamar(
      usuarios.beto,
      "GET",
      `/api/espacios/${INEXISTENTE}/eventos`,
    );
    expect(sseAjeno.status).toBe(404);
    expect(sseAjeno.cuerpo).toEqual(sseInexistente.cuerpo);
    expect((await llamar(null, "GET", `/api/espacios/${espacio}/eventos`)).status).toBe(401);
  });

  it("un usuario ajeno recibe 404 al editar y un miembro recibe 403", async () => {
    const espacio = await crearEspacio(usuarios.ana, "Editable");
    await invitar(usuarios.ana, espacio, usuarios.carla);
    const cambio = { nombre: "Renombrado", compartirZona: true, zonaGeohash: "9g3q" };

    expect((await llamar(usuarios.beto, "PATCH", `/api/espacios/${espacio}`, cambio)).status).toBe(
      404,
    );
    expect((await llamar(usuarios.carla, "PATCH", `/api/espacios/${espacio}`, cambio)).status).toBe(
      403,
    );
    const ok = await llamar(usuarios.ana, "PATCH", `/api/espacios/${espacio}`, cambio);
    expect(ok.status).toBe(200);
    expect(ok.cuerpo).toMatchObject({
      nombre: "Renombrado",
      compartir_zona: true,
      zona_geohash: "9g3q",
    });
    // privacidad (RNF-08): la zona no puede ser más precisa que ~colonia
    expect(
      (await llamar(usuarios.ana, "PATCH", `/api/espacios/${espacio}`, { zonaGeohash: "9g3qxyz1" }))
        .status,
    ).toBe(400);
    expect((await llamar(usuarios.ana, "PATCH", `/api/espacios/${espacio}`, {})).status).toBe(400);
  });

  it("solo el propietario invita; un ajeno recibe 404", async () => {
    const espacio = await crearEspacio(usuarios.ana, "Invitaciones");
    await invitar(usuarios.ana, espacio, usuarios.carla);
    expect(
      (await llamar(usuarios.beto, "POST", `/api/espacios/${espacio}/invitaciones`)).status,
    ).toBe(404);
    expect(
      (await llamar(usuarios.carla, "POST", `/api/espacios/${espacio}/invitaciones`)).status,
    ).toBe(403);
    const ok = await llamar(usuarios.ana, "POST", `/api/espacios/${espacio}/invitaciones`);
    expect(ok.status).toBe(201);
    expect(ok.cuerpo.token.length).toBeGreaterThanOrEqual(32);
  });

  it("invitaciones: el token es de un solo uso y vence", async () => {
    const espacio = await crearEspacio(usuarios.ana, "Un solo uso");
    const inv = (await llamar(usuarios.ana, "POST", `/api/espacios/${espacio}/invitaciones`))
      .cuerpo;

    // en la base solo queda el hash, nunca el token
    const guardado = await owner.query(
      "SELECT encode(token_hash, 'hex') h FROM app.invitaciones WHERE espacio_id = $1",
      [espacio],
    );
    expect(guardado.rows[0].h).toHaveLength(64);
    expect(guardado.rows[0].h).not.toContain(inv.token);

    const primera = await llamar(usuarios.carla, "POST", "/api/invitaciones/aceptar", {
      token: inv.token,
    });
    expect(primera.status).toBe(200);
    expect(primera.cuerpo.espacio_id).toBe(espacio);
    // otro usuario con el mismo token: igual que un token inventado
    const segunda = await llamar(usuarios.dani, "POST", "/api/invitaciones/aceptar", {
      token: inv.token,
    });
    const inventado = await llamar(usuarios.dani, "POST", "/api/invitaciones/aceptar", {
      token: "x".repeat(43),
    });
    expect(segunda.status).toBe(404);
    expect(segunda.cuerpo).toEqual(inventado.cuerpo);
    expect(segunda.cuerpo.codigo).toBe("invitacion_invalida");

    // vencida
    const otra = (await llamar(usuarios.ana, "POST", `/api/espacios/${espacio}/invitaciones`))
      .cuerpo;
    await owner.query(
      "UPDATE app.invitaciones SET expira_en = now() - interval '1 minute' WHERE espacio_id = $1 AND usada_en IS NULL",
      [espacio],
    );
    expect(
      (await llamar(usuarios.dani, "POST", "/api/invitaciones/aceptar", { token: otra.token }))
        .status,
    ).toBe(404);

    // quien ya es miembro no consume la invitación
    const libre = (await llamar(usuarios.ana, "POST", `/api/espacios/${espacio}/invitaciones`))
      .cuerpo;
    expect(
      (await llamar(usuarios.carla, "POST", "/api/invitaciones/aceptar", { token: libre.token }))
        .status,
    ).toBe(200);
    expect(
      (await llamar(usuarios.dani, "POST", "/api/invitaciones/aceptar", { token: libre.token }))
        .status,
    ).toBe(200);
  });

  it("miembros: un ajeno recibe 404 y un miembro no quita a otros", async () => {
    const espacio = await crearEspacio(usuarios.ana, "Miembros");
    await invitar(usuarios.ana, espacio, usuarios.carla);
    await invitar(usuarios.ana, espacio, usuarios.dani);
    const [ana, carla, dani] = await Promise.all([
      usuarioId(usuarios.ana),
      usuarioId(usuarios.carla),
      usuarioId(usuarios.dani),
    ]);
    const quitar = (token: string, quien: string) =>
      llamar(token, "DELETE", `/api/espacios/${espacio}/miembros/${quien}`);

    expect((await quitar(usuarios.beto, dani)).status).toBe(404); // ajeno
    expect((await quitar(usuarios.carla, dani)).status).toBe(403); // miembro quitando a otro
    expect((await quitar(usuarios.ana, ana)).cuerpo.codigo).toBe("transferir_primero"); // el propietario no sale sin transferir
    expect((await quitar(usuarios.ana, dani)).status).toBe(204); // el propietario quita a un miembro
    expect((await quitar(usuarios.carla, carla)).status).toBe(204); // un miembro se sale solo
    expect((await quitar(usuarios.ana, carla)).status).toBe(404); // ya no es miembro
    expect((await llamar(usuarios.carla, "GET", `/api/espacios/${espacio}`)).status).toBe(404);
  });

  it("transferir propiedad: solo el propietario y solo a un miembro", async () => {
    const espacio = await crearEspacio(usuarios.ana, "Traspaso");
    await invitar(usuarios.ana, espacio, usuarios.carla);
    const [beto, carla] = await Promise.all([usuarioId(usuarios.beto), usuarioId(usuarios.carla)]);
    const transferir = (token: string, a: string) =>
      llamar(token, "POST", `/api/espacios/${espacio}/transferir`, { usuarioId: a });

    expect((await transferir(usuarios.beto, carla)).status).toBe(404); // ajeno
    expect((await transferir(usuarios.carla, carla)).status).toBe(403); // miembro
    expect((await transferir(usuarios.ana, beto)).status).toBe(400); // destino que no es miembro
    expect((await transferir(usuarios.ana, await usuarioId(usuarios.ana))).status).toBe(400); // a sí mismo
    expect((await transferir(usuarios.ana, carla)).status).toBe(204);

    const roles = await owner.query(
      "SELECT u.nombre, m.rol FROM app.membresias m JOIN app.usuarios u ON u.id = m.usuario_id WHERE m.espacio_id = $1 ORDER BY u.nombre",
      [espacio],
    );
    expect(roles.rows).toEqual([
      { nombre: "Ana María", rol: "miembro" },
      { nombre: "Carla", rol: "propietario" },
    ]);
    expect(
      (await llamar(usuarios.ana, "PATCH", `/api/espacios/${espacio}`, { nombre: "x" })).status,
    ).toBe(403);
    expect(
      (await llamar(usuarios.carla, "PATCH", `/api/espacios/${espacio}`, { nombre: "Nuevo dueño" }))
        .status,
    ).toBe(200);
  });

  it("reclamar nodos: errores indistinguibles y límite de intentos", async () => {
    const espacio = await crearEspacio(usuarios.ana, "Reclamos");
    const ajenoEspacio = await crearEspacio(usuarios.beto, "De Beto");
    const nodo = await fabricarNodo(10);
    const reclamar = (token: string, cuerpo: object) =>
      llamar(token, "POST", "/api/nodos/reclamar", cuerpo);

    // código incorrecto, nodo inexistente y espacio ajeno: la misma respuesta
    const malCodigo = await reclamar(usuarios.ana, {
      nodoId: nodo,
      codigo: "AAAA-BBBB-CCCC",
      espacioId: espacio,
    });
    const sinNodo = await reclamar(usuarios.ana, {
      nodoId: INEXISTENTE,
      codigo: codigoN(10),
      espacioId: espacio,
    });
    expect(malCodigo.status).toBe(404);
    expect(malCodigo.cuerpo).toEqual(sinNodo.cuerpo);
    expect(malCodigo.cuerpo.codigo).toBe("reclamo_invalido");
    // reclamar hacia un espacio que no es tuyo: no revela si el nodo o el código eran buenos
    const espacioAjeno = await reclamar(usuarios.ana, {
      nodoId: nodo,
      codigo: codigoN(10),
      espacioId: ajenoEspacio,
    });
    expect(espacioAjeno.status).toBe(404);
    expect(
      (await owner.query("SELECT estado FROM app.nodos WHERE id = $1", [nodo])).rows[0].estado,
    ).toBe("fabricado");

    // con el código bien (en minúsculas y con guiones, como lo teclea una persona) se reclama
    const suscriptor = crearValkey(vk.url("worker"), "prueba-invalidacion");
    const invalidados: string[] = [];
    suscriptor.on("message", (_c, m) => invalidados.push(m));
    await suscriptor.subscribe("invalidar:nodo");
    const codigo = codigoN(10)
      .toLowerCase()
      .replace(/(.{4})/g, "$1-")
      .slice(0, 14);
    const ok = await reclamar(usuarios.ana, { nodoId: nodo, codigo, espacioId: espacio });
    expect(ok.status).toBe(200);
    expect(ok.cuerpo).toMatchObject({
      id: nodo,
      espacio_id: espacio,
      estado: "reclamado",
      perfil_id: "cisterna",
    });
    expect(ok.cuerpo.estado_actual).toMatchObject({ nivel: "sin_datos", conectado: false });
    // ingest tiene que olvidar lo que sabía del nodo
    for (let i = 0; i < 50 && !invalidados.includes(nodo); i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(invalidados).toContain(nodo);
    suscriptor.disconnect();

    // ya reclamado: el mismo error de siempre
    const otra = await reclamar(usuarios.ana, {
      nodoId: nodo,
      codigo: codigoN(10),
      espacioId: espacio,
    });
    expect(otra.cuerpo).toEqual(malCodigo.cuerpo);

    // un miembro (no propietario) no reclama
    await invitar(usuarios.ana, espacio, usuarios.carla);
    const libre = await fabricarNodo(11);
    expect(
      (await reclamar(usuarios.carla, { nodoId: libre, codigo: codigoN(11), espacioId: espacio }))
        .status,
    ).toBe(403);

    // perfil inexistente: 400, no 500
    expect(
      (
        await reclamar(usuarios.ana, {
          nodoId: libre,
          codigo: codigoN(11),
          espacioId: espacio,
          perfilId: "inventado",
        })
      ).status,
    ).toBe(400);

    // fuerza bruta: 10 fallos y el undécimo intento se frena, aun con el código correcto
    const atacante = tokenDe("uid-fuerza", "fuerza@example.com");
    const suyo = await crearEspacio(atacante, "Suyo");
    const objetivo = await fabricarNodo(12);
    for (let i = 0; i < 10; i++) {
      expect(
        (await reclamar(atacante, { nodoId: objetivo, codigo: `MALO-${i}-MALO`, espacioId: suyo }))
          .status,
      ).toBe(404);
    }
    const frenado = await reclamar(atacante, {
      nodoId: objetivo,
      codigo: codigoN(12),
      espacioId: suyo,
    });
    expect(frenado.status).toBe(429);
    expect(frenado.cuerpo.codigo).toBe("demasiadas_solicitudes");
    // el límite es por usuario: otro sigue pudiendo
    expect(
      (await reclamar(usuarios.ana, { nodoId: objetivo, codigo: codigoN(12), espacioId: espacio }))
        .status,
    ).toBe(200);
  });

  it("un usuario ajeno recibe 404 en el nodo, sus lecturas y sus acciones", async () => {
    const espacio = await crearEspacio(usuarios.ana, "Con nodo");
    const espacioBeto = await crearEspacio(usuarios.beto, "Con nodo de Beto");
    await invitar(usuarios.ana, espacio, usuarios.carla);
    const nodo = await fabricarNodo(20);
    expect(
      (
        await llamar(usuarios.ana, "POST", "/api/nodos/reclamar", {
          nodoId: nodo,
          codigo: codigoN(20),
          espacioId: espacio,
        })
      ).status,
    ).toBe(200);
    await owner.query(
      `INSERT INTO ts.lecturas (nodo_id, espacio_id, ts, seq, ph)
       VALUES ($1, $2, now() - interval '2 minutes', 1, 7.1), ($1, $2, now() - interval '1 minute', 2, 7.2)`,
      [nodo, espacio],
    );

    const url = `/api/nodos/${nodo}`;
    const intentos = [
      llamar(usuarios.beto, "GET", url),
      llamar(usuarios.beto, "GET", `${url}/lecturas`),
      llamar(usuarios.beto, "PATCH", url, { nombre: "mío" }),
      llamar(usuarios.beto, "POST", `${url}/desvincular`),
    ];
    const respuestas = await Promise.all(intentos);
    for (const r of respuestas) expect(r.status).toBe(404);
    const inexistente = await llamar(usuarios.beto, "GET", `/api/nodos/${INEXISTENTE}`);
    expect(respuestas[0]?.cuerpo).toEqual(inexistente.cuerpo);
    expect(
      (await owner.query("SELECT nombre FROM app.nodos WHERE id = $1", [nodo])).rows[0].nombre,
    ).toBeNull();

    // el propietario ve el nodo, sus lecturas y puede renombrarlo; el miembro lee pero no modifica
    expect(
      (await llamar(usuarios.ana, "GET", url)).cuerpo.estado_actual.ultimos_valores,
    ).toBeNull();
    const lecturas = (await llamar(usuarios.carla, "GET", `${url}/lecturas?limite=5`)).cuerpo
      .lecturas;
    expect(lecturas.map((l: { seq: number }) => l.seq)).toEqual([2, 1]);
    expect((await llamar(usuarios.carla, "PATCH", url, { nombre: "x" })).status).toBe(403);
    expect((await llamar(usuarios.carla, "POST", `${url}/desvincular`)).status).toBe(403);
    expect((await llamar(usuarios.ana, "PATCH", url, { nombre: "Cisterna" })).cuerpo.nombre).toBe(
      "Cisterna",
    );
    expect((await llamar(usuarios.ana, "PATCH", url, { perfilId: "beber" })).cuerpo.perfil_id).toBe(
      "beber",
    );
    expect((await llamar(usuarios.ana, "PATCH", url, { perfilId: "inventado" })).status).toBe(400);
    expect((await llamar(usuarios.ana, "PATCH", url, {})).status).toBe(400);

    // desvincular: el nodo queda libre, sus alarmas se cierran y deja de ser visible para el espacio
    await owner.query(
      "INSERT INTO app.alarmas (nodo_id, espacio_id, tipo, severidad) VALUES ($1, $2, 'nivel', 'mala')",
      [nodo, espacio],
    );
    expect((await llamar(usuarios.ana, "POST", `${url}/desvincular`)).status).toBe(204);
    const fila = (
      await owner.query("SELECT estado, espacio_id FROM app.nodos WHERE id = $1", [nodo])
    ).rows[0];
    expect(fila).toEqual({ estado: "desvinculado", espacio_id: null });
    expect(
      (await owner.query("SELECT estado FROM app.alarmas WHERE nodo_id = $1", [nodo])).rows[0]
        .estado,
    ).toBe("resuelta");
    expect((await llamar(usuarios.ana, "GET", url)).status).toBe(404);
    expect((await llamar(usuarios.ana, "POST", `${url}/desvincular`)).status).toBe(404);

    // otro puede reclamarlo con su código, pero no hereda el historial del espacio anterior
    expect(
      (
        await llamar(usuarios.beto, "POST", "/api/nodos/reclamar", {
          nodoId: nodo,
          codigo: codigoN(20),
          espacioId: espacioBeto,
        })
      ).status,
    ).toBe(200);
    expect((await llamar(usuarios.beto, "GET", `${url}/lecturas`)).cuerpo.lecturas).toEqual([]);
  });

  it("historial: un usuario ajeno recibe 404; el miembro ve el nivel predominante por día", async () => {
    // dueños propios: Ana ya usó su cupo de espacios en pruebas anteriores
    const hana = tokenDe("uid-hana", "hana@example.com", "Hana");
    const ivo = tokenDe("uid-ivo", "ivo@example.com", "Ivo");
    const espacio = await crearEspacio(hana, "Con historial");
    await invitar(hana, espacio, ivo);
    const nodo = await fabricarNodo(21);
    expect(
      (
        await llamar(hana, "POST", "/api/nodos/reclamar", {
          nodoId: nodo,
          codigo: codigoN(21),
          espacioId: espacio,
        })
      ).status,
    ).toBe(200);
    // hoy: 3 buenas y 1 crítica (predominante: buena); hace 5 días: 2 malas y 2 regulares (empate: gana la peor);
    // hace 10 días: una regular (solo entra en la ventana de 30 días)
    const evaluar = (cuando: string, nivel: string, wqi: number) =>
      owner.query(
        `INSERT INTO ts.evaluaciones (nodo_id, espacio_id, ts, wqi, nivel, confianza, version_algoritmo, subindices)
         VALUES ($1, $2, now() - $3::interval, $4, $5::app.nivel, 'ok', 'prueba', '{}')`,
        [nodo, espacio, cuando, wqi, nivel],
      );
    for (const [cuando, nivel, wqi] of [
      ["1 second", "buena", 90],
      ["2 seconds", "buena", 92],
      ["3 seconds", "buena", 94],
      ["4 seconds", "critica", 20],
      ["5 days 1 second", "mala", 50],
      ["5 days 2 seconds", "mala", 52],
      ["5 days 3 seconds", "regular", 70],
      ["5 days 4 seconds", "regular", 72],
      ["10 days", "regular", 65],
    ] as const) {
      await evaluar(cuando, nivel, wqi);
    }
    await owner.query(
      `INSERT INTO ts.lecturas (nodo_id, espacio_id, ts, seq, ph, tds)
       VALUES ($1, $2, now() - interval '1 second', 101, 7.0, 300), ($1, $2, now() - interval '2 seconds', 102, 7.4, 320)`,
      [nodo, espacio],
    );

    const url = `/api/nodos/${nodo}/historial`;
    const ajeno = await llamar(usuarios.beto, "GET", url);
    expect(ajeno.status).toBe(404);
    expect(ajeno.cuerpo).toEqual(
      (await llamar(usuarios.beto, "GET", `/api/nodos/${INEXISTENTE}/historial`)).cuerpo,
    );
    expect((await llamar(usuarios.beto, "GET", `${url}?dias=30`)).status).toBe(404);

    const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Mexico_City" });
    const siete = await llamar(ivo, "GET", url); // 7 por omisión
    expect(siete.status).toBe(200);
    expect(siete.cuerpo).toMatchObject({ nodo_id: nodo, dias: 7, zona: "America/Mexico_City" });
    expect(siete.cuerpo.historial.map((d: { dia: string }) => d.dia.length)).toEqual([10, 10]);
    const [haceCinco, dia] = siete.cuerpo.historial;
    expect(dia.dia).toBe(hoy);
    expect(dia.nivel).toBe("buena");
    expect(dia.evaluaciones).toEqual({ buena: 3, regular: 0, mala: 0, critica: 1, sin_datos: 0 });
    expect(dia.wqi_min).toBe(20);
    expect(dia.promedios).toMatchObject({ lecturas: 2, tds: 310, temperatura: null });
    expect(dia.promedios.ph).toBeCloseTo(7.2, 4); // la columna es real (float4)
    expect(haceCinco.nivel).toBe("mala");
    expect(haceCinco.promedios).toBeNull();
    expect(haceCinco.dia < dia.dia).toBe(true);

    const treinta = await llamar(ivo, "GET", `${url}?dias=30`);
    expect(treinta.cuerpo.historial.map((d: { nivel: string }) => d.nivel)).toEqual([
      "regular",
      "mala",
      "buena",
    ]);

    for (const mala of ["dias=15", "dias=0", "dias=abc"]) {
      expect((await llamar(ivo, "GET", `${url}?${mala}`)).status).toBe(400);
    }
    expect((await llamar("token-invalido", "GET", url)).status).toBe(401);
  });

  it("eliminar la cuenta borra solo lo propio y no afecta a otros", async () => {
    const zoe = tokenDe("uid-zoe", "zoe@example.com", "Zoe");
    const espacioSolo = await crearEspacio(zoe, "Solo de Zoe");
    const espacioAna = await crearEspacio(usuarios.ana, "Compartido con Zoe");
    await invitar(usuarios.ana, espacioAna, zoe);
    const nodo = await fabricarNodo(30);
    await llamar(zoe, "POST", "/api/nodos/reclamar", {
      nodoId: nodo,
      codigo: codigoN(30),
      espacioId: espacioSolo,
    });
    const nodoAna = await fabricarNodo(31);
    await llamar(usuarios.ana, "POST", "/api/nodos/reclamar", {
      nodoId: nodoAna,
      codigo: codigoN(31),
      espacioId: espacioAna,
    });
    for (const [n, e] of [
      [nodo, espacioSolo],
      [nodoAna, espacioAna],
    ] as const) {
      await owner.query(
        "INSERT INTO ts.lecturas (nodo_id, espacio_id, ts, seq, ph) VALUES ($1, $2, now(), 1, 7)",
        [n, e],
      );
    }
    const zoeId = await usuarioId(zoe);

    // una propietaria con otros miembros debe transferir antes
    const conOtros = await crearEspacio(zoe, "Con otros");
    await invitar(zoe, conOtros, usuarios.dani);
    const bloqueada = await llamar(zoe, "DELETE", "/api/yo");
    expect(bloqueada.status).toBe(409);
    expect(bloqueada.cuerpo.codigo).toBe("transferir_primero");
    expect((await owner.query("SELECT 1 FROM app.usuarios WHERE id = $1", [zoeId])).rowCount).toBe(
      1,
    );
    expect(
      (
        await llamar(zoe, "POST", `/api/espacios/${conOtros}/transferir`, {
          usuarioId: await usuarioId(usuarios.dani),
        })
      ).status,
    ).toBe(204);

    expect((await llamar(zoe, "DELETE", "/api/yo")).status).toBe(204);

    // lo de Zoe desaparece...
    expect((await owner.query("SELECT 1 FROM app.usuarios WHERE id = $1", [zoeId])).rowCount).toBe(
      0,
    );
    expect(
      (await owner.query("SELECT 1 FROM app.espacios WHERE id = $1", [espacioSolo])).rowCount,
    ).toBe(0);
    expect(
      (await owner.query("SELECT 1 FROM ts.lecturas WHERE espacio_id = $1", [espacioSolo]))
        .rowCount,
    ).toBe(0);
    expect(
      (await owner.query("SELECT estado, espacio_id FROM app.nodos WHERE id = $1", [nodo])).rows[0],
    ).toEqual({
      estado: "desvinculado",
      espacio_id: null,
    });
    expect(
      (await owner.query("SELECT 1 FROM app.membresias WHERE usuario_id = $1", [zoeId])).rowCount,
    ).toBe(0);
    const auditoria = await owner.query(
      "SELECT detalle FROM app.auditoria WHERE accion = 'cuenta.eliminada' AND actor_id = $1",
      [zoeId],
    );
    expect(auditoria.rows[0].detalle).toEqual({ espacios_borrados: 1 });

    // ...y lo de los demás, no
    expect(
      (await owner.query("SELECT 1 FROM app.espacios WHERE id = $1", [espacioAna])).rowCount,
    ).toBe(1);
    expect(
      (await owner.query("SELECT 1 FROM ts.lecturas WHERE espacio_id = $1", [espacioAna])).rowCount,
    ).toBe(1);
    expect(
      (await owner.query("SELECT 1 FROM app.espacios WHERE id = $1", [conOtros])).rowCount,
    ).toBe(1);
    expect((await llamar(usuarios.ana, "GET", `/api/nodos/${nodoAna}`)).status).toBe(200);
    // el mismo token vuelve a crear un perfil nuevo y vacío
    expect((await llamar(zoe, "GET", "/api/espacios")).cuerpo.espacios).toEqual([]);
  });

  it("telegram: el vínculo y las preferencias son de cada usuario", async () => {
    const mensajes: { chat: number; texto: string }[] = [];
    const manejar = crearManejadorTelegram({
      bd: bdApp,
      valkey: valkeyApi,
      log: crearLogger("prueba", "silent"),
      cliente: {
        enviarMensaje: async (chat, texto) => {
          mensajes.push({ chat, texto });
        },
      },
    });
    let idUpdate = 0;
    const escribir = (chat: number, texto: string, tipo = "private") =>
      manejar({ update_id: ++idUpdate, message: { chat: { id: chat, type: tipo }, text: texto } });
    const ultimo = () => mensajes.at(-1)?.texto ?? "";
    const tokenDe_ = (enlace: string) => new URL(enlace).searchParams.get("start") as string;
    const vinculado = async (token: string) =>
      (await llamar(token, "GET", "/api/yo/telegram")).cuerpo.vinculado as boolean;
    const enlace = async (token: string) => {
      const r = await llamar(token, "POST", "/api/yo/telegram/vinculo");
      expect(r.status).toBe(201);
      return tokenDe_(r.cuerpo.enlace as string);
    };

    // ── vinculación por deep link ──
    expect((await llamar(null, "POST", "/api/yo/telegram/vinculo")).status).toBe(401);
    const respuesta = await llamar(usuarios.ana, "POST", "/api/yo/telegram/vinculo");
    expect(respuesta.cuerpo.enlace).toMatch(
      /^https:\/\/t\.me\/lympha_prueba_bot\?start=[A-Za-z0-9_-]{43}$/,
    );
    const tokenAna = tokenDe_(respuesta.cuerpo.enlace as string);
    const ttl = await valkeyApi.ttl(`tg:vincular:${tokenAna}`);
    expect(ttl).toBeGreaterThan(590);
    expect(ttl).toBeLessThanOrEqual(600);
    expect(await vinculado(usuarios.ana)).toBe(false);

    await escribir(5001, `/start ${tokenAna}`);
    expect(ultimo()).toMatch(/quedó vinculado/);
    expect(await vinculado(usuarios.ana)).toBe(true);
    expect(await vinculado(usuarios.beto)).toBe(false);
    expect(
      (await owner.query("SELECT usuario_id FROM app.vinculos_telegram WHERE chat_id = 5001"))
        .rows[0].usuario_id,
    ).toBe(await usuarioId(usuarios.ana));

    // el enlace es de un solo uso
    await escribir(5002, `/start ${tokenAna}`);
    expect(ultimo()).toMatch(/venció o ya se usó/);
    expect(
      (await owner.query("SELECT 1 FROM app.vinculos_telegram WHERE chat_id = 5002")).rowCount,
    ).toBe(0);
    await escribir(5002, "/start token-inventado-que-no-existe");
    expect(ultimo()).toMatch(/venció o ya se usó/);

    // un chat que ya es de Ana no se le puede quitar a Ana con otro enlace
    const tokenBeto = await enlace(usuarios.beto);
    await escribir(5001, `/start ${tokenBeto}`);
    expect(ultimo()).toMatch(/ya está vinculado a otra cuenta/);
    expect(await vinculado(usuarios.beto)).toBe(false);
    expect(await vinculado(usuarios.ana)).toBe(true);

    // desde un grupo no se vincula, y el enlace no se gasta
    const tokenGrupo = await enlace(usuarios.beto);
    await escribir(5003, `/start ${tokenGrupo}`, "group");
    expect(ultimo()).toMatch(/conversación privada/);
    await escribir(5003, `/start ${tokenGrupo}`);
    expect(await vinculado(usuarios.beto)).toBe(true);

    // quitar el vínculo de uno no toca el del otro
    expect((await llamar(usuarios.beto, "DELETE", "/api/yo/telegram")).status).toBe(204);
    expect(await vinculado(usuarios.beto)).toBe(false);
    expect(await vinculado(usuarios.ana)).toBe(true);
    expect((await llamar(usuarios.ana, "GET", "/api/yo/telegram")).cuerpo.vinculado_en).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );

    // /desvincular desde el chat de Ana quita el vínculo de Ana y de nadie más
    await escribir(5001, "/desvincular");
    expect(ultimo()).toMatch(/ya no te enviaré avisos/);
    expect(await vinculado(usuarios.ana)).toBe(false);
    await escribir(5001, "/desvincular");
    expect(ultimo()).toMatch(/no estaba vinculado/);
    await escribir(5001, "hola");
    expect(ultimo()).toMatch(/Ajustes → Telegram/);

    // pedir enlaces tiene límite por usuario
    for (let i = 0; i < 10; i++) await enlace(usuarios.dani);
    expect((await llamar(usuarios.dani, "POST", "/api/yo/telegram/vinculo")).status).toBe(429);
    expect((await llamar(usuarios.carla, "POST", "/api/yo/telegram/vinculo")).status).toBe(201);

    // ── preferencias ──
    const espacio = await crearEspacio(usuarios.ana, "Con preferencias");
    const nodo = await fabricarNodo(40);
    await llamar(usuarios.ana, "POST", "/api/nodos/reclamar", {
      nodoId: nodo,
      codigo: codigoN(40),
      espacioId: espacio,
    });
    const pref = {
      nodo_id: null,
      niveles: ["regular", "mala", "critica"],
      silencio_inicio: "22:00",
      silencio_fin: "07:00",
      zona_horaria: "America/Mexico_City",
      recordatorio_h: 3,
    };
    const guardada = await llamar(usuarios.ana, "PUT", "/api/yo/notificaciones", pref);
    expect(guardada.status).toBe(200);
    expect(guardada.cuerpo.defecto).toEqual(pref);
    // otra vez lo mismo: actualiza, no duplica
    await llamar(usuarios.ana, "PUT", "/api/yo/notificaciones", { ...pref, recordatorio_h: 5 });
    expect((await llamar(usuarios.ana, "GET", "/api/yo/notificaciones")).cuerpo.defecto).toEqual({
      ...pref,
      recordatorio_h: 5,
    });

    // Beto no ve nada de Ana: recibe los valores por defecto
    expect((await llamar(usuarios.beto, "GET", "/api/yo/notificaciones")).cuerpo).toEqual({
      defecto: {
        nodo_id: null,
        niveles: ["mala", "critica"],
        silencio_inicio: null,
        silencio_fin: null,
        zona_horaria: "America/Mexico_City",
        recordatorio_h: 6,
      },
      nodos: [],
    });

    // un nodo ajeno e uno inexistente responden igual (404), y no se escribe nada
    const ajeno = await llamar(usuarios.beto, "PUT", "/api/yo/notificaciones", {
      ...pref,
      nodo_id: nodo,
    });
    const inexistente = await llamar(usuarios.beto, "PUT", "/api/yo/notificaciones", {
      ...pref,
      nodo_id: INEXISTENTE,
    });
    expect(ajeno.status).toBe(404);
    expect(ajeno.cuerpo).toEqual(inexistente.cuerpo);
    expect((await llamar(usuarios.beto, "DELETE", `/api/yo/notificaciones/${nodo}`)).status).toBe(
      404,
    );
    expect(
      (await owner.query("SELECT 1 FROM app.preferencias_notificacion WHERE nodo_id = $1", [nodo]))
        .rowCount,
    ).toBe(0);

    // Ana sí: preferencia de un nodo y su borrado
    const deNodo = await llamar(usuarios.ana, "PUT", "/api/yo/notificaciones", {
      ...pref,
      nodo_id: nodo,
      niveles: ["critica"],
      silencio_inicio: null,
      silencio_fin: null,
    });
    expect(deNodo.cuerpo.nodos).toHaveLength(1);
    expect(deNodo.cuerpo.nodos[0]).toMatchObject({ nodo_id: nodo, niveles: ["critica"] });
    expect((await llamar(usuarios.ana, "DELETE", `/api/yo/notificaciones/${nodo}`)).status).toBe(
      204,
    );
    expect((await llamar(usuarios.ana, "GET", "/api/yo/notificaciones")).cuerpo.nodos).toEqual([]);

    // entradas inválidas: 400
    const malas: Record<string, unknown>[] = [
      { ...pref, silencio_fin: null }, // horario a medias
      { ...pref, zona_horaria: "Marte/Olympus" },
      { ...pref, niveles: ["mala", "mala"] },
      { ...pref, niveles: ["buena"] },
      { ...pref, silencio_inicio: "25:00" },
      { ...pref, recordatorio_h: 0 },
      { ...pref, recordatorio_h: 73 },
      { ...pref, extra: true },
    ];
    for (const mala of malas) {
      expect((await llamar(usuarios.ana, "PUT", "/api/yo/notificaciones", mala)).status).toBe(400);
    }
    expect((await llamar(null, "GET", "/api/yo/notificaciones")).status).toBe(401);
  });

  it("alarmas: un ajeno recibe 404 al listar y al atender", async () => {
    // Ana ya llegó al máximo de espacios en las pruebas anteriores: esta propietaria es nueva.
    const elena = tokenDe("uid-elena", "elena@example.com", "Elena");
    const espacio = await crearEspacio(elena, "Con alarmas");
    await invitar(elena, espacio, usuarios.carla);
    const nodo = await fabricarNodo(41);
    await llamar(elena, "POST", "/api/nodos/reclamar", {
      nodoId: nodo,
      codigo: codigoN(41),
      espacioId: espacio,
    });
    const activa = (
      await owner.query(
        `INSERT INTO app.alarmas (nodo_id, espacio_id, tipo, severidad, causa)
         VALUES ($1, $2, 'nivel', 'mala', 'La turbidez está alta.') RETURNING id`,
        [nodo, espacio],
      )
    ).rows[0].id as string;
    const resuelta = (
      await owner.query(
        `INSERT INTO app.alarmas (nodo_id, espacio_id, tipo, severidad, estado, resuelta_en)
         VALUES ($1, $2, 'sensor', 'regular', 'resuelta', now()) RETURNING id`,
        [nodo, espacio],
      )
    ).rows[0].id as string;

    // un usuario ajeno no distingue un espacio o una alarma ajenos de uno inexistente
    const ajenoLista = await llamar(usuarios.beto, "GET", `/api/espacios/${espacio}/alarmas`);
    const vacioLista = await llamar(usuarios.beto, "GET", `/api/espacios/${INEXISTENTE}/alarmas`);
    expect(ajenoLista.status).toBe(404);
    expect(ajenoLista.cuerpo).toEqual(vacioLista.cuerpo);
    const ajenoAtender = await llamar(usuarios.beto, "POST", `/api/alarmas/${activa}/atender`);
    const vacioAtender = await llamar(usuarios.beto, "POST", `/api/alarmas/${INEXISTENTE}/atender`);
    expect(ajenoAtender.status).toBe(404);
    expect(ajenoAtender.cuerpo).toEqual(vacioAtender.cuerpo);
    expect(
      (await owner.query("SELECT estado FROM app.alarmas WHERE id = $1", [activa])).rows[0].estado,
    ).toBe("activa");
    expect((await llamar(null, "GET", `/api/espacios/${espacio}/alarmas`)).status).toBe(401);
    expect((await llamar(null, "POST", `/api/alarmas/${activa}/atender`)).status).toBe(401);

    // los miembros ven el historial, con estado y sin correos
    const lista = await llamar(usuarios.carla, "GET", `/api/espacios/${espacio}/alarmas`);
    expect(lista.status).toBe(200);
    expect(lista.cuerpo.alarmas.map((a: { id: string }) => a.id).sort()).toEqual(
      [activa, resuelta].sort(),
    );
    expect(JSON.stringify(lista.cuerpo)).not.toContain("@");
    const abiertas = await llamar(
      usuarios.carla,
      "GET",
      `/api/espacios/${espacio}/alarmas?estado=abiertas`,
    );
    expect(abiertas.cuerpo.alarmas.map((a: { id: string }) => a.id)).toEqual([activa]);
    expect(
      (await llamar(usuarios.carla, "GET", `/api/espacios/${espacio}/alarmas?estado=inventado`))
        .status,
    ).toBe(400);

    // atender: el cambio llega por el canal del espacio y queda registrado quién fue
    const suscriptor = valkeyApi.duplicate();
    suscriptor.on("error", () => undefined);
    const eventos: string[] = [];
    suscriptor.on("message", (_canal: string, mensaje: string) => eventos.push(mensaje));
    await suscriptor.subscribe(`espacio:${espacio}`);
    try {
      const atendida = await llamar(usuarios.carla, "POST", `/api/alarmas/${activa}/atender`);
      expect(atendida.status).toBe(200);
      expect(atendida.cuerpo).toMatchObject({
        id: activa,
        estado: "atendida",
        atendida_por: { id: await usuarioId(usuarios.carla), nombre: "Carla" },
      });
      for (let i = 0; i < 50 && eventos.length === 0; i++)
        await new Promise((r) => setTimeout(r, 20));
      expect(JSON.parse(eventos[0] ?? "{}")).toMatchObject({
        alarma_id: activa,
        cambio: "atendida",
        estado: "atendida",
      });
    } finally {
      suscriptor.disconnect();
    }

    // solo se atiende una alarma activa: otra atención o una alarma resuelta es un conflicto
    const otra = await llamar(elena, "POST", `/api/alarmas/${activa}/atender`);
    expect(otra.status).toBe(409);
    expect(otra.cuerpo.codigo).toBe("alarma_no_activa");
    expect((await llamar(elena, "POST", `/api/alarmas/${resuelta}/atender`)).status).toBe(409);
    expect(
      (await llamar(elena, "GET", `/api/espacios/${espacio}/alarmas?estado=atendida`)).cuerpo
        .alarmas[0].atendida_por.nombre,
    ).toBe("Carla");
  });

  it("calibración: un ajeno recibe 404, el miembro 403 y la recta se calcula en el servidor", async () => {
    const ana = tokenDe("uid-ana-cal", "ana-cal@example.com", "Ana C");
    const espacio = await crearEspacio(ana, "Calibrar");
    await invitar(ana, espacio, usuarios.carla);
    const nodo = await fabricarNodo(50);
    expect(
      (
        await llamar(ana, "POST", "/api/nodos/reclamar", {
          nodoId: nodo,
          codigo: codigoN(50),
          espacioId: espacio,
        })
      ).status,
    ).toBe(200);
    const puntos = [
      { crudo: 6.8, referencia: 7 },
      { crudo: 3.9, referencia: 4 },
    ];

    // un ajeno no distingue el nodo de uno inexistente, ni para leer ni para escribir
    const ajenos = await Promise.all([
      llamar(usuarios.beto, "GET", `/api/calibraciones?nodo_id=${nodo}`),
      llamar(usuarios.beto, "POST", "/api/calibraciones", {
        nodo_id: nodo,
        parametro: "ph",
        puntos,
      }),
      llamar(usuarios.beto, "POST", "/api/calibraciones/restablecer", {
        nodo_id: nodo,
        parametro: "ph",
      }),
    ]);
    for (const r of ajenos) expect(r.status).toBe(404);
    const inexistente = await llamar(
      usuarios.beto,
      "GET",
      `/api/calibraciones?nodo_id=${INEXISTENTE}`,
    );
    expect(ajenos[0]?.cuerpo).toEqual(inexistente.cuerpo);

    // el miembro lee pero no calibra
    expect(
      (await llamar(usuarios.carla, "GET", `/api/calibraciones?nodo_id=${nodo}`)).cuerpo,
    ).toEqual({
      calibraciones: [],
    });
    expect(
      (
        await llamar(usuarios.carla, "POST", "/api/calibraciones", {
          nodo_id: nodo,
          parametro: "ph",
          puntos,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await llamar(usuarios.carla, "POST", "/api/calibraciones/restablecer", {
          nodo_id: nodo,
          parametro: "ph",
        })
      ).status,
    ).toBe(403);

    // el cliente no manda coeficientes ni puntos inservibles
    expect(
      (
        await llamar(ana, "POST", "/api/calibraciones", {
          nodo_id: nodo,
          parametro: "ph",
          puntos,
          pendiente: 9,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await llamar(ana, "POST", "/api/calibraciones", {
          nodo_id: nodo,
          parametro: "temperatura",
          puntos,
        })
      ).status,
    ).toBe(400);
    const repetidos = await llamar(ana, "POST", "/api/calibraciones", {
      nodo_id: nodo,
      parametro: "ph",
      puntos: [
        { crudo: 5, referencia: 4 },
        { crudo: 5, referencia: 7 },
      ],
    });
    expect(repetidos.status).toBe(422);
    expect(repetidos.cuerpo.codigo).toBe("puntos_repetidos");

    // el propietario calibra: la recta sale de los puntos
    const sinCalibrar = await llamar(ana, "GET", `/api/nodos/${nodo}`);
    expect(sinCalibrar.cuerpo.calibracion).toEqual({ ultima_en: null, estado: "sin_calibrar" });
    const primera = await llamar(ana, "POST", "/api/calibraciones", {
      nodo_id: nodo,
      parametro: "ph",
      puntos,
    });
    expect(primera.status).toBe(201);
    expect(primera.cuerpo.pendiente).toBeCloseTo(3 / 2.9, 6);
    expect(primera.cuerpo.activa).toBe(true);
    expect(primera.cuerpo.r2).toBeCloseTo(1, 6);
    const vigente = await llamar(usuarios.carla, "GET", `/api/nodos/${nodo}`);
    expect(vigente.cuerpo.calibracion.estado).toBe("vigente");
    expect(vigente.cuerpo.calibracion.ultima_en).toBe(primera.cuerpo.creado_en);

    // una segunda deja inactiva a la primera (una sola activa por nodo y parámetro)
    const segunda = await llamar(ana, "POST", "/api/calibraciones", {
      nodo_id: nodo,
      parametro: "ph",
      puntos: [
        { crudo: 7.1, referencia: 7 },
        { crudo: 4.2, referencia: 4 },
        { crudo: 10.3, referencia: 10 },
      ],
    });
    expect(segunda.status).toBe(201);
    const historial = (
      await llamar(usuarios.carla, "GET", `/api/calibraciones?nodo_id=${nodo}&parametro=ph`)
    ).cuerpo.calibraciones;
    expect(historial.map((c: { activa: boolean }) => c.activa)).toEqual([true, false]);
    expect(historial[0].id).toBe(segunda.cuerpo.id);

    // revertir a la anterior: solo el propietario
    const activar = `/api/calibraciones/${primera.cuerpo.id}/activar`;
    expect((await llamar(usuarios.beto, "POST", activar)).status).toBe(404);
    expect((await llamar(usuarios.carla, "POST", activar)).status).toBe(403);
    const revertida = await llamar(ana, "POST", activar);
    expect(revertida.status).toBe(200);
    expect(revertida.cuerpo.activa).toBe(true);
    expect(
      (
        await owner.query(
          "SELECT count(*)::int AS n FROM app.calibraciones_sensor WHERE nodo_id = $1 AND activa",
          [nodo],
        )
      ).rows[0].n,
    ).toBe(1);

    // restablecer deja la identidad y el nodo vuelve a verse sin calibrar
    const identidad = await llamar(ana, "POST", "/api/calibraciones/restablecer", {
      nodo_id: nodo,
      parametro: "ph",
    });
    expect(identidad.status).toBe(201);
    expect([identidad.cuerpo.pendiente, identidad.cuerpo.desfase, identidad.cuerpo.origen]).toEqual(
      [1, 0, "identidad"],
    );
    expect((await llamar(ana, "GET", `/api/nodos/${nodo}`)).cuerpo.calibracion.estado).toBe(
      "sin_calibrar",
    );

    // pasado el plazo del perfil, la calibración guiada vigente figura como vencida
    await llamar(ana, "POST", activar);
    await owner.query(
      "UPDATE app.calibraciones_sensor SET creado_en = now() - interval '91 days' WHERE id = $1",
      [primera.cuerpo.id],
    );
    expect((await llamar(ana, "GET", `/api/nodos/${nodo}`)).cuerpo.calibracion.estado).toBe(
      "vencida",
    );
  });

  it("calibración: el worker corrige las lecturas con la recta vigente y conserva el valor crudo", async () => {
    const dani = tokenDe("uid-dani-cal", "dani-cal@example.com", "Dani C");
    const espacio = await crearEspacio(dani, "Corregir");
    const nodo = await fabricarNodo(51);
    await llamar(dani, "POST", "/api/nodos/reclamar", {
      nodoId: nodo,
      codigo: codigoN(51),
      espacioId: espacio,
    });
    await llamar(dani, "POST", "/api/calibraciones", {
      nodo_id: nodo,
      parametro: "ph",
      puntos: [
        { crudo: 6, referencia: 7 },
        { crudo: 3, referencia: 4 },
      ],
    }); // pendiente 1, desfase 1

    const bdSistema = crearBdSistema(pgc.url("system"), "prueba-calibracion", 3);
    try {
      const cache = crearCacheCalibracion(bdSistema);
      const base = {
        nodoId: nodo,
        espacioId: espacio,
        temperatura: 20,
        conductividad: null,
        turbidez: null,
        tds: null,
      };
      const ts = Date.now() - 60_000;
      const lote: LecturaTrabajo[] = [
        { ...base, ts, seq: 1, ph: 6.5, recibidoEn: ts },
        { ...base, ts: ts + 1000, seq: 2, ph: null, recibidoEn: ts },
      ];
      const corregido = calibrarFilas(lote, await cache.coeficientes([nodo]));
      expect(lote[0]?.ph).toBe(6.5); // no muta la entrada
      expect(corregido[0]?.ph).toBeCloseTo(7.5, 6);
      expect(corregido[0]?.crudo).toEqual({ ph: 6.5 });
      expect(corregido[1]?.crudo).toBeUndefined();
      await guardarLecturas(bdSistema, corregido);
      const guardada = (
        await owner.query("SELECT ph, crudo FROM ts.lecturas WHERE nodo_id = $1 AND seq = 1", [
          nodo,
        ])
      ).rows[0];
      expect(guardada.ph).toBeCloseTo(7.5, 4);
      expect(guardada.crudo).toEqual({ ph: 6.5 });

      // la API devuelve ambos valores
      const api = await llamar(dani, "GET", `/api/nodos/${nodo}/lecturas?limite=5`);
      expect(api.cuerpo.lecturas.find((l: { seq: number }) => l.seq === 1).crudo).toEqual({
        ph: 6.5,
      });

      // al restablecer y invalidar la caché, las lecturas siguientes pasan tal cual
      await llamar(dani, "POST", "/api/calibraciones/restablecer", {
        nodo_id: nodo,
        parametro: "ph",
      });
      cache.invalidar(nodo);
      const sinCorregir = calibrarFilas(lote, await cache.coeficientes([nodo]));
      expect(sinCorregir[0]?.ph).toBe(6.5);
      expect(sinCorregir[0]?.crudo).toBeUndefined();
    } finally {
      await bdSistema.cerrar();
    }
  });

  it("toda prueba de acceso cruzado citada en rutas-cubiertas.ts existe en este archivo", () => {
    const fuentes = new Map(
      ["api.test.ts", "admin.test.ts"].map((f) => [
        `test/${f}`,
        readFileSync(join(import.meta.dirname, f), "utf8"),
      ]),
    );
    const citadas = Object.values(RUTAS_CUBIERTAS)
      .filter((c) => c !== "publica")
      .map((c) => (c as { aislamiento: string }).aislamiento);
    const sinPrueba = citadas.filter((c) => {
      const [archivo, nombre] = c.split(" › ");
      return !fuentes.get(archivo ?? "")?.includes(`it("${nombre}"`);
    });
    expect(sinPrueba).toEqual([]);
  });
});
