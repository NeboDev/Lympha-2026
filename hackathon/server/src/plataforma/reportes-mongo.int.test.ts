import { randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AlertaDoc } from "../modulos/alertas/index.ts";
import { crearDocumentoNodo } from "../modulos/nodos/index.ts";
import { crearServicioReportes } from "../modulos/reportes/index.ts";
import { crearAlmacenReportesMongo } from "./almacen-reportes-mongo.ts";
import { cargarCatalogo } from "./catalogo.ts";
import { crearGeneradorPdf } from "./generador-reportes.ts";
import { asegurarIndices } from "./indices.ts";
import { cargarSimboloLympha } from "./logo-svg.ts";
import { cargarMarca } from "./marca.ts";
import { conectarMongo, type Mongo } from "./mongo.ts";

/**
 * Integración del reporte contra un Mongo real. Se omite salvo que pongas ATL_TEST_MONGO=1 (ver
 * almacen-mongo.int.test.ts). Usa una base temporal que borra al terminar.
 */
const activo = process.env.ATL_TEST_MONGO === "1" && !!process.env.MONGODB_URI;

describe.skipIf(!activo)("reportes en Mongo (integración)", () => {
  let mongo: Mongo;
  const nombreDb = `atl_test_${randomBytes(4).toString("hex")}`;
  const catalogo = cargarCatalogo();
  const HORA = 3600_000;
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - 24 * HORA);
  const hace = (h: number) => new Date(hasta.getTime() - h * HORA);

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

  async function sembrar() {
    const comunidadId = new ObjectId();
    await mongo.db.collection("comunidades").insertOne({ _id: comunidadId, nombre: "Primaria X" });
    const nodo = crearDocumentoNodo({
      comunidadId,
      nombre: "Tinaco azotea",
      tokenCifrado: "v1:a:b:c",
      host: "blynk.cloud",
      catalogo,
    });
    const otro = crearDocumentoNodo({
      comunidadId,
      nombre: "Cisterna",
      tokenCifrado: "v1:a:b:c",
      host: "blynk.cloud",
      catalogo,
    });
    await mongo.db.collection("nodos").insertMany([nodo, otro]);
    return { comunidadId, nodo, otro };
  }

  const alerta = (nodo: ObjectId, comunidad: ObjectId, parte: Partial<AlertaDoc>): AlertaDoc => ({
    _id: new ObjectId(),
    nodo_id: nodo,
    comunidad_id: comunidad,
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

  it("lee solo lo del periodo y del nodo: muestras, alertas, eventos y calibraciones", async () => {
    const { comunidadId, nodo, otro } = await sembrar();
    const a = crearAlmacenReportesMongo(mongo.db);

    await mongo.db.collection("muestras").insertMany([
      { nodo_id: nodo._id, ts: hace(30), seq: 1, sesion: 0, v: { ph: 7 } }, // antes del periodo
      {
        nodo_id: nodo._id,
        ts: hace(3),
        seq: 3,
        sesion: 0,
        v: { ph: 7.2 },
        estados: { ph: "en_rango" },
      },
      { nodo_id: nodo._id, ts: hace(2), seq: 2, sesion: 0, v: { ph: 7.1 } },
      { nodo_id: otro._id, ts: hace(2), seq: 1, sesion: 0, v: { ph: 5 } }, // otro nodo
    ]);
    const m = await a.muestras(nodo._id, desde, hasta);
    expect(m.map((x) => x.v.ph)).toEqual([7.2, 7.1]); // ordenadas por hora
    expect(m[0]?.estados).toEqual({ ph: "en_rango" });
    expect(Object.keys(m[0] ?? {}).sort()).toEqual(["estados", "ts", "v"]); // sin el resto

    const dentro = alerta(nodo._id, comunidadId, {});
    const sigueAbierta = alerta(nodo._id, comunidadId, {
      tipo: "sensor",
      abierta: hace(40), // abrió antes del periodo
      cerrada: null,
      estado: "abierta",
    });
    const vieja = alerta(nodo._id, comunidadId, { abierta: hace(60), cerrada: hace(50) }); // terminó antes
    const futura = alerta(nodo._id, comunidadId, {
      tipo: "cambio_rapido",
      abierta: new Date(hasta.getTime() + HORA),
      cerrada: null,
      estado: "abierta",
    });
    const ajena = alerta(otro._id, comunidadId, {});
    await mongo.db.collection("alertas").insertMany([dentro, sigueAbierta, vieja, futura, ajena]);
    const al = await a.alertas(nodo._id, desde, hasta);
    expect(al.map((x) => x._id.toHexString())).toEqual(
      [sigueAbierta, dentro].map((x) => x._id.toHexString()), // por apertura ascendente
    );

    await mongo.db.collection("eventos").insertMany([
      {
        nodo_id: nodo._id,
        comunidad_id: comunidadId,
        ts: hace(6),
        tipo: "sin_datos",
        mensaje: "sin datos",
      },
      {
        nodo_id: null,
        comunidad_id: comunidadId,
        ts: hace(5),
        tipo: "bitacora",
        mensaje: "Se lavó el tinaco",
      },
      {
        nodo_id: otro._id,
        comunidad_id: comunidadId,
        ts: hace(4),
        tipo: "sin_datos",
        mensaje: "de otro nodo",
      },
      {
        nodo_id: nodo._id,
        comunidad_id: comunidadId,
        ts: hace(3),
        tipo: "alerta_abre",
        mensaje: "ya va en alertas",
      },
      {
        nodo_id: nodo._id,
        comunidad_id: comunidadId,
        ts: hace(48),
        tipo: "sin_datos",
        mensaje: "muy viejo",
      },
      {
        nodo_id: nodo._id,
        comunidad_id: new ObjectId(),
        ts: hace(2),
        tipo: "sin_datos",
        mensaje: "otra comunidad",
      },
    ]);
    const ev = await a.eventos(comunidadId, nodo._id, desde, hasta);
    expect(ev.map((e) => e.mensaje)).toEqual(["sin datos", "Se lavó el tinaco"]);
    expect(ev.map((e) => e.tipo)).toEqual(["sin_datos", "bitacora"]);

    await mongo.db.collection("calibraciones").insertMany([
      {
        nodo_id: nodo._id,
        ts: hace(10),
        parametro: "ph",
        pendiente_pct_nernst: 98,
        offset_mv: 3,
        diagnostico: "buena",
      },
      {
        nodo_id: nodo._id,
        ts: hace(100),
        parametro: "ph",
        pendiente_pct_nernst: 90,
        offset_mv: 5,
        diagnostico: "revisar",
      },
    ]);
    expect((await a.calibraciones(nodo._id, desde, hasta)).map((c) => c.diagnostico)).toEqual([
      "buena",
    ]);

    expect((await a.nodo(nodo._id))?.nombre).toBe("Tinaco azotea");
    expect((await a.comunidad(comunidadId))?.nombre).toBe("Primaria X");
    expect(await a.nodo(new ObjectId())).toBeNull();
  });

  it("de punta a punta: genera el PDF desde Mongo y deja el resumen con su huella", async () => {
    const { comunidadId, nodo } = await sembrar();
    const muestras = Array.from({ length: 24 * 60 }, (_, i) => ({
      nodo_id: nodo._id,
      ts: new Date(desde.getTime() + i * 60_000),
      seq: i + 1,
      sesion: 0,
      v: { ph: 7 + Math.sin(i / 120) * 0.5 },
    }));
    await mongo.db.collection("muestras").insertMany(muestras);

    const servicio = crearServicioReportes({
      almacen: crearAlmacenReportesMongo(mongo.db),
      catalogo,
      marca: cargarMarca(),
    });
    const generador = crearGeneradorPdf({ servicio, logo: cargarSimboloLympha() });
    const r = await generador.ultimosDias(nodo._id, 1, "Prueba de integración");

    expect(r.pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(r.nombreArchivo).toMatch(/^reporte-tinaco-azotea-\d{4}-\d{2}-\d{2}\.pdf$/);
    const guardado = await mongo.db
      .collection("reportes")
      .findOne({ _id: new ObjectId(r.reporte.id) });
    expect(guardado).toMatchObject({
      nodo_id: nodo._id,
      comunidad_id: comunidadId,
      generado_por: "Prueba de integración",
      hash: r.reporte.hash,
    });
    expect(guardado?.resumen.parametros.ph.n).toBeGreaterThan(1000);
    expect(guardado?.resumen.cobertura_pct).toBeGreaterThan(95);
  }, 60_000);
});
