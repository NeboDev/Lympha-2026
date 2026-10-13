import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registrarRutas } from "../src/main/api.ts";
import { crearBdApp } from "../src/platform/db.ts";
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
let bdCerrar: () => Promise<void>;

const usuarios = {
  ana: tokenDe("uid-ana", "ana@example.com", "Ana"),
  beto: tokenDe("uid-beto", "beto@example.com", "Beto"),
  carla: tokenDe("uid-carla", "carla@example.com", "Carla"),
  dani: tokenDe("uid-dani", "dani@example.com", "Dani"),
};

async function llamar(
  token: string | null,
  method: "GET" | "POST" | "PATCH" | "DELETE",
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

  it("toda prueba de acceso cruzado citada en rutas-cubiertas.ts existe en este archivo", () => {
    const fuente = readFileSync(join(import.meta.dirname, "api.test.ts"), "utf8");
    const citadas = Object.values(RUTAS_CUBIERTAS)
      .filter((c) => c !== "publica")
      .map((c) => (c as { aislamiento: string }).aislamiento);
    const sinPrueba = citadas.filter((c) => {
      const [archivo, nombre] = c.split(" › ");
      return archivo !== "test/api.test.ts" || !fuente.includes(`it("${nombre}"`);
    });
    expect(sinPrueba).toEqual([]);
  });
});
