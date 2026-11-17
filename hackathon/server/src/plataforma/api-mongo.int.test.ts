import { randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AlertaDoc } from "../modulos/alertas/index.ts";
import { crearApp } from "../modulos/api/index.ts";
import type { ComunidadDoc } from "../modulos/comunidades/index.ts";
import { crearDocumentoNodo } from "../modulos/nodos/index.ts";
import {
  crearAlmacenBitacoraMongo,
  crearAlmacenCalibracionesMongo,
  crearAlmacenComunidadesMongo,
  crearAlmacenNodosMongo,
  crearAlmacenUsuariosMongo,
} from "./almacen-api-mongo.ts";
import { cargarCatalogo } from "./catalogo.ts";
import { descifrar } from "./cifrado.ts";
import { asegurarIndices } from "./indices.ts";
import { cargarSimboloLympha } from "./logo-svg.ts";
import { cargarMarca } from "./marca.ts";
import { conectarMongo, type Mongo } from "./mongo.ts";
import { crearServiciosApi } from "./servicios-api.ts";

/**
 * Integración de la API contra un Mongo real. Se omite salvo que pongas ATL_TEST_MONGO=1 (ver
 * almacen-mongo.int.test.ts). Usa una base temporal que borra al terminar.
 */
const activo = process.env.ATL_TEST_MONGO === "1" && !!process.env.MONGODB_URI;

describe.skipIf(!activo)("API sobre MongoDB (integración)", () => {
  let mongo: Mongo;
  const nombreDb = `atl_test_${randomBytes(4).toString("hex")}`;
  const catalogo = cargarCatalogo();
  const HORA = 3600_000;

  beforeAll(async () => {
    mongo = await conectarMongo({
      mongoUri: process.env.MONGODB_URI as string,
      mongoDb: nombreDb,
      mongoDns: (process.env.MONGODB_DNS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
    await asegurarIndices(mongo.db);
  }, 60_000);

  afterAll(async () => {
    if (!mongo) return;
    await mongo.db.dropDatabase();
    await mongo.cerrar();
  }, 60_000);

  const comunidad = (nombre: string, miembros: ComunidadDoc["miembros"]): ComunidadDoc => ({
    _id: new ObjectId(),
    nombre,
    tipo: "otro",
    miembros,
    telegram: null,
    creado: new Date(),
  });

  it("usuarios: el registro es idempotente y actualiza nombre y correo", async () => {
    const a = crearAlmacenUsuariosMongo(mongo.db);
    await a.registrar({ uid: "u1", correo: "a@x.mx", nombre: "Ana" }, new Date(1));
    await a.registrar({ uid: "u1", correo: "a@x.mx", nombre: "Ana" }, new Date(2));
    await a.registrar({ uid: "u1", correo: "nuevo@x.mx", nombre: "Ana María" }, new Date(3));
    const docs = await mongo.db.collection("usuarios").find({ google_uid: "u1" }).toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      correo: "nuevo@x.mx",
      nombre: "Ana María",
      creado: new Date(1),
    });
  });

  it("comunidades: guarda, busca por miembro (con orden) y cuenta como responsable", async () => {
    const a = crearAlmacenComunidadesMongo(mongo.db);
    const b = comunidad("B de Beto", [{ uid: "beto", rol: "responsable" }]);
    const z = comunidad("Z compartida", [
      { uid: "beto", rol: "responsable" },
      { uid: "carla", rol: "integrante" },
    ]);
    const m = comunidad("M de Carla", [{ uid: "carla", rol: "responsable" }]);
    for (const c of [z, b, m]) await a.insertar(c);

    expect((await a.deUsuario("beto")).map((c) => c.nombre)).toEqual(["B de Beto", "Z compartida"]);
    expect((await a.deUsuario("carla")).map((c) => c.nombre)).toEqual([
      "M de Carla",
      "Z compartida",
    ]);
    expect(await a.deUsuario("nadie")).toEqual([]);
    expect(await a.contarResponsable("beto")).toBe(2);
    expect(await a.contarResponsable("carla")).toBe(1); // en Z solo es integrante
    expect((await a.obtener(z._id))?.nombre).toBe("Z compartida");
    expect(await a.obtener(new ObjectId())).toBeNull();
  });

  it("nodos: la serie agrupa por tramos con promedio, mínimo y máximo, sin inventar huecos", async () => {
    const a = crearAlmacenNodosMongo(mongo.db);
    const nodo = crearDocumentoNodo({
      comunidadId: new ObjectId(),
      nombre: "Tinaco",
      tokenCifrado: "v1:a:b:c",
      host: "blynk.cloud",
      catalogo,
    });
    await a.insertar(nodo);
    expect(await a.existeNombre(nodo.comunidad_id, "Tinaco")).toBe(true);
    expect(await a.existeNombre(nodo.comunidad_id, "Otro")).toBe(false);
    expect(await a.existeNombre(new ObjectId(), "Tinaco")).toBe(false);

    // Tramos de 600 s alineados a la hora en punto (15:00, 15:10, 15:20…).
    const base = Date.UTC(2026, 10, 19, 15, 0, 0);
    const en = (s: number, v: Record<string, number>, n = nodo._id) => ({
      nodo_id: n,
      ts: new Date(base + s * 1000),
      seq: s,
      sesion: 0,
      v,
    });
    await mongo.db.collection("muestras").insertMany([
      en(10, { ph: 7 }),
      en(180, { ph: 8 }),
      en(590, { ph: 6 }),
      en(605, { ph: 7.5 }),
      en(1810, {}), // tramo 15:30 con una muestra sin pH
      en(30, { ph: 1 }, new ObjectId()), // de otro nodo
    ]);

    const serie = await a.serie(nodo._id, ["ph"], new Date(base), new Date(base + 2 * HORA), 600);
    expect(serie).toEqual([
      { ts: new Date(base), n: 3, v: { ph: { prom: 7, min: 6, max: 8 } } },
      { ts: new Date(base + 600_000), n: 1, v: { ph: { prom: 7.5, min: 7.5, max: 7.5 } } },
      { ts: new Date(base + 1800_000), n: 1, v: {} },
    ]);
    // Con un paso de una hora todo cae en el mismo tramo.
    const hora = await a.serie(nodo._id, ["ph"], new Date(base), new Date(base + 2 * HORA), 3600);
    expect(hora).toHaveLength(1);
    expect(hora[0]?.n).toBe(5);
    expect(hora[0]?.v.ph?.prom).toBeCloseTo((7 + 8 + 6 + 7.5) / 4);
    // Un id de parámetro raro no se cuela en la consulta.
    const raro = await a.serie(
      nodo._id,
      ["ph; drop", "$where"],
      new Date(base),
      new Date(base + HORA),
      600,
    );
    expect(raro.map((p) => [p.n, p.v])).toEqual([
      [3, {}],
      [1, {}],
      [1, {}],
    ]);
  });

  it("nodos: alertas y eventos filtran por periodo, nodo y comunidad", async () => {
    const a = crearAlmacenNodosMongo(mongo.db);
    const comunidadId = new ObjectId();
    const nodoId = new ObjectId();
    const otro = new ObjectId();
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - 24 * HORA);
    const hace = (h: number) => new Date(hasta.getTime() - h * HORA);
    const alerta = (parte: Partial<AlertaDoc>): AlertaDoc => ({
      _id: new ObjectId(),
      nodo_id: nodoId,
      comunidad_id: comunidadId,
      tipo: "nivel",
      parametro: "ph",
      severidad: "alta",
      severidad_maxima: "alta",
      estado: "cerrada",
      abierta: hace(5),
      cerrada: hace(4),
      ultimo_aviso: null,
      recordatorios: 0,
      valor_apertura: 6.2,
      valor_cierre: 7,
      ...parte,
    });
    const dentro = alerta({ abierta: hace(5) });
    const reciente = alerta({ tipo: "sensor", abierta: hace(1), cerrada: null, estado: "abierta" });
    const vieja = alerta({ abierta: hace(60), cerrada: hace(50) });
    const ajena = alerta({ nodo_id: otro });
    await mongo.db.collection("alertas").insertMany([dentro, reciente, vieja, ajena]);
    // Las más recientes primero, y el límite recorta.
    expect((await a.alertas(nodoId, desde, hasta, 10)).map((x) => x._id.toHexString())).toEqual([
      reciente._id.toHexString(),
      dentro._id.toHexString(),
    ]);
    expect(await a.alertas(nodoId, desde, hasta, 1)).toHaveLength(1);

    await mongo.db.collection("eventos").insertMany([
      {
        nodo_id: nodoId,
        comunidad_id: comunidadId,
        ts: hace(6),
        tipo: "sin_datos",
        mensaje: "sin datos",
      },
      {
        nodo_id: null,
        comunidad_id: comunidadId,
        ts: hace(3),
        tipo: "bitacora",
        mensaje: "nota de la comunidad",
        autor_uid: "ana",
      },
      {
        nodo_id: otro,
        comunidad_id: comunidadId,
        ts: hace(2),
        tipo: "sin_datos",
        mensaje: "de otro nodo",
      },
      {
        nodo_id: nodoId,
        comunidad_id: comunidadId,
        ts: hace(2),
        tipo: "alerta_abre",
        mensaje: "va en alertas",
      },
      {
        nodo_id: nodoId,
        comunidad_id: comunidadId,
        ts: hace(48),
        tipo: "sin_datos",
        mensaje: "muy viejo",
      },
      {
        nodo_id: nodoId,
        comunidad_id: new ObjectId(),
        ts: hace(1),
        tipo: "sin_datos",
        mensaje: "otra comunidad",
      },
    ]);
    const ev = await a.eventos(nodoId, comunidadId, desde, hasta, 10);
    expect(ev.map((e) => e.mensaje)).toEqual(["nota de la comunidad", "sin datos"]); // recientes primero
    expect(ev[0]?.autor_uid).toBe("ana");
    expect(ev[1]?.autor_uid).toBeNull();
  });

  it("bitácora y calibraciones se guardan y se listan", async () => {
    const nodoId = new ObjectId();
    const comunidadId = new ObjectId();
    await crearAlmacenBitacoraMongo(mongo.db).registrar({
      nodo_id: nodoId,
      comunidad_id: comunidadId,
      ts: new Date(),
      tipo: "bitacora",
      severidad: "info",
      parametro: null,
      mensaje: "Se lavó el tinaco",
      datos: {},
      autor_uid: "ana",
    });
    expect(
      await mongo.db.collection("eventos").countDocuments({ nodo_id: nodoId, tipo: "bitacora" }),
    ).toBe(1);

    const cal = crearAlmacenCalibracionesMongo(mongo.db);
    const doc = (ts: Date, diag: "buena" | "revisar") => ({
      _id: new ObjectId(),
      nodo_id: nodoId,
      ts,
      parametro: "ph",
      temp: 25,
      puntos: [
        { valor: 4, mv: 177 },
        { valor: 7, mv: 0 },
      ],
      pendiente_mv_por_ph: -59,
      pendiente_pct_nernst: 99,
      offset_mv: 0,
      diagnostico: diag,
      autor_uid: "ana",
    });
    const evento = (d: ReturnType<typeof doc>) => ({
      nodo_id: nodoId,
      comunidad_id: comunidadId,
      ts: d.ts,
      tipo: "calibracion" as const,
      severidad: "info" as const,
      parametro: "ph",
      mensaje: "Calibración registrada",
      datos: { calibracion_id: d._id.toHexString(), diagnostico: d.diagnostico },
      autor_uid: "ana",
    });
    const vieja = doc(new Date(1000), "revisar");
    const nueva = doc(new Date(2000), "buena");
    await cal.registrar(vieja, evento(vieja));
    await cal.registrar(nueva, evento(nueva));
    expect((await cal.listar(nodoId, 10)).map((c) => c.diagnostico)).toEqual(["buena", "revisar"]);
    expect(await cal.listar(nodoId, 1)).toHaveLength(1);
    expect(
      await mongo.db.collection("eventos").countDocuments({ nodo_id: nodoId, tipo: "calibracion" }),
    ).toBe(2);
  });

  it("de punta a punta por HTTP: comunidad, nodo, nota, calibración, serie, eventos y reporte PDF", async () => {
    const T = Date.now();
    const personas: Record<string, { uid: string; correo: string; nombre: string }> = {
      ana: { uid: "e2e-ana", correo: "ana@e2e.mx", nombre: "Ana" },
      carla: { uid: "e2e-carla", correo: "carla@e2e.mx", nombre: "Carla" },
    };
    const servicios = crearServiciosApi({
      db: mongo.db,
      catalogo,
      marca: cargarMarca(),
      verificador: {
        async verificar(token) {
          const p = personas[token];
          if (!p) throw new Error("token inválido");
          return p;
        },
      },
      demoToken: null,
      claveCifrado: Buffer.alloc(32, 9),
      blynkHost: "blynk.cloud",
      logo: cargarSimboloLympha(),
      usuarioBot: "lympha26_bot",
      comprobador: {
        async comprobar() {
          return "conectado";
        },
      },
    });
    const app = crearApp({
      corsOrigenes: [],
      salud: { mongo: async () => true, blynk: async () => true },
      servicios,
    });
    const pedir = (token: string, metodo: "GET" | "POST", url: string, cuerpo?: object) =>
      app.inject({
        method: metodo,
        url,
        headers: { authorization: `Bearer ${token}` },
        ...(cuerpo ? { payload: cuerpo } : {}),
      });

    const com = (
      await pedir("ana", "POST", "/api/comunidades", { nombre: "Primaria E2E", tipo: "escuela" })
    ).json();
    const TOKEN_BLYNK = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
    const alta = await pedir("ana", "POST", `/api/comunidades/${com.id}/nodos`, {
      nombre: "Tinaco E2E",
      token_blynk: TOKEN_BLYNK,
    });
    expect(alta.statusCode).toBe(201);
    expect(alta.body).not.toContain(TOKEN_BLYNK);
    const nodoId = alta.json().id as string;

    // El token quedó cifrado en la base y se puede descifrar con la clave.
    const guardado = await mongo.db.collection("nodos").findOne({ _id: new ObjectId(nodoId) });
    expect(guardado?.blynk.token_cifrado).not.toContain(TOKEN_BLYNK);
    expect(descifrar(guardado?.blynk.token_cifrado, Buffer.alloc(32, 9))).toBe(TOKEN_BLYNK);

    expect(
      (await pedir("ana", "POST", `/api/nodos/${nodoId}/bitacora`, { texto: "Se lavó el tinaco." }))
        .statusCode,
    ).toBe(201);
    expect(
      (
        await pedir("ana", "POST", `/api/nodos/${nodoId}/calibraciones`, {
          parametro: "ph",
          puntos: [
            { valor: 4, mv: 177.48 },
            { valor: 7, mv: 0 },
          ],
        })
      ).json().diagnostico,
    ).toBe("buena");

    await mongo.db.collection("muestras").insertMany(
      Array.from({ length: 120 }, (_, i) => ({
        nodo_id: new ObjectId(nodoId),
        ts: new Date(T - (120 - i) * 60_000),
        seq: i + 1,
        sesion: 0,
        v: { ph: 7 + Math.sin(i / 20) * 0.3 },
      })),
    );
    const serie = (await pedir("ana", "GET", `/api/nodos/${nodoId}/muestras?paso=600`)).json();
    expect(serie.puntos.length).toBeGreaterThan(5);
    expect(serie.puntos[0].v.ph).toEqual({
      prom: expect.any(Number),
      min: expect.any(Number),
      max: expect.any(Number),
    });

    const ev = (await pedir("ana", "GET", `/api/nodos/${nodoId}/eventos`)).json();
    expect(ev.eventos.map((e: { tipo: string }) => e.tipo).sort()).toEqual([
      "bitacora",
      "calibracion",
    ]);
    expect(ev.eventos.every((e: { propia: boolean }) => e.propia)).toBe(true);

    const pdf = await pedir("ana", "POST", `/api/nodos/${nodoId}/reportes`, { dias: 1 });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(
      await mongo.db.collection("reportes").countDocuments({ nodo_id: new ObjectId(nodoId) }),
    ).toBe(1);
    const anteriores = (await pedir("ana", "GET", `/api/nodos/${nodoId}/reportes`)).json().reportes;
    expect(anteriores).toHaveLength(1);
    expect(anteriores[0]).toMatchObject({
      generado_por: "Ana",
      huella: expect.stringMatching(/^[0-9a-f]{12}$/),
    });

    const link = (await pedir("ana", "POST", `/api/comunidades/${com.id}/telegram/vinculo`)).json();
    expect(link.enlace).toMatch(/^https:\/\/t\.me\/lympha26_bot\?start=[A-Za-z0-9_-]{43}$/);

    // Carla, que no es de la comunidad, no ve nada.
    for (const [m, u] of [
      ["GET", `/api/nodos/${nodoId}`],
      ["GET", `/api/nodos/${nodoId}/muestras`],
      ["GET", `/api/nodos/${nodoId}/eventos`],
      ["POST", `/api/nodos/${nodoId}/reportes`],
    ] as const) {
      expect((await pedir("carla", m, u)).statusCode, `${m} ${u}`).toBe(404);
    }
    expect((await pedir("carla", "GET", "/api/yo")).json().comunidades).toEqual([]);
    const yo = (await pedir("ana", "GET", "/api/yo")).json();
    expect(yo.comunidades.map((c: { nombre: string }) => c.nombre)).toEqual(["Primaria E2E"]);
  }, 90_000);
});
