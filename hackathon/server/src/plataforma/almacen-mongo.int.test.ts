import { randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MuestraDoc } from "../modulos/ingesta/index.ts";
import { crearDocumentoNodo } from "../modulos/nodos/index.ts";
import { crearAlmacenMongo } from "./almacen-mongo.ts";
import { cargarCatalogo } from "./catalogo.ts";
import { asegurarIndices } from "./indices.ts";
import { conectarMongo, type Mongo } from "./mongo.ts";

/**
 * Integración contra un Mongo real (Atlas o local). Se omite salvo que pongas ATL_TEST_MONGO=1:
 *   ATL_TEST_MONGO=1 node --env-file=.env node_modules/vitest/vitest.mjs run src/plataforma/almacen-mongo.int.test.ts
 * Usa una base temporal `atl_test_<azar>` y la borra al terminar; no toca la base `atl`.
 */
const activo = process.env.ATL_TEST_MONGO === "1" && !!process.env.MONGODB_URI;

describe.skipIf(!activo)("almacén de Mongo (integración)", () => {
  let mongo: Mongo;
  const nombreDb = `atl_test_${randomBytes(4).toString("hex")}`;

  beforeAll(async () => {
    mongo = await conectarMongo({
      mongoUri: process.env.MONGODB_URI as string,
      mongoDb: nombreDb,
      mongoDns: (process.env.MONGODB_DNS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
    // Un índice de una versión anterior: asegurarIndices debe borrarlo.
    await mongo.db
      .collection("muestras")
      .createIndex({ nodo_id: 1, seq: 1 }, { unique: true, name: "nodo_id_1_seq_1" });
    await asegurarIndices(mongo.db);
  }, 60_000);

  afterAll(async () => {
    if (!mongo) return;
    await mongo.db.dropDatabase();
    await mongo.cerrar();
  }, 60_000);

  const muestra = (nodo: ObjectId, seq: number, sesion: number, ts: Date): MuestraDoc => ({
    nodo_id: nodo,
    ts,
    seq,
    sesion,
    v: { ph: 7.1 },
    crudo: { ph: 7.15 },
    detalles: { ph: { cambio_rapido: false, cambio: null, motivos_sensor: [] } },
    estado: "en_rango",
    estados: { ph: "en_rango" },
    estable: true,
    estado_nodo: 0,
  });

  it("borra el índice viejo y crea el de (nodo_id, sesion, seq)", async () => {
    const nombres = (await mongo.db.collection("muestras").indexes()).map((i) => i.name);
    expect(nombres).not.toContain("nodo_id_1_seq_1");
    expect(nombres).toContain("nodo_id_1_sesion_1_seq_1");
  });

  it("inserta de forma idempotente y permite el mismo seq en otra sesión", async () => {
    const almacen = crearAlmacenMongo(mongo.db);
    const nodo = new ObjectId();
    const ts = new Date();
    expect(await almacen.insertarMuestra(muestra(nodo, 1, 0, ts))).toBe("insertada");
    expect(await almacen.insertarMuestra(muestra(nodo, 1, 0, ts))).toBe("duplicada");
    expect(await almacen.insertarMuestra(muestra(nodo, 1, 1, ts))).toBe("insertada");
    expect(await mongo.db.collection("muestras").countDocuments({ nodo_id: nodo })).toBe(2);
  });

  it("carga la ventana ordenada y solo desde la fecha pedida", async () => {
    const almacen = crearAlmacenMongo(mongo.db);
    const nodo = new ObjectId();
    const base = Date.now() - 60 * 60_000;
    for (let i = 0; i < 5; i++) {
      await almacen.insertarMuestra(muestra(nodo, i + 1, 0, new Date(base + i * 60_000)));
    }
    const ventana = await almacen.cargarVentana(nodo, new Date(base + 2 * 60_000));
    expect(ventana).toHaveLength(3);
    expect(ventana.map((m) => m.ts.getTime())).toEqual(
      [...ventana.map((m) => m.ts.getTime())].sort(),
    );
    expect(ventana[0]?.v).toEqual({ ph: 7.1 });
  });

  it("lista nodos, guarda `ultimo` y registra eventos", async () => {
    const almacen = crearAlmacenMongo(mongo.db);
    const nodo = crearDocumentoNodo({
      comunidadId: new ObjectId(),
      nombre: "Nodo de integración",
      tokenCifrado: "v1:a:b:c",
      host: "blynk.cloud",
      catalogo: cargarCatalogo(),
    });
    await mongo.db.collection("nodos").insertOne({ ...nodo });
    const ts = new Date();
    await almacen.guardarUltimo(nodo._id, {
      ts,
      v: { ph: 7.1 },
      estado: "en_rango",
      estados: { ph: "en_rango" },
      seq: 7,
      sesion: 0,
      estable: true,
      ultimo_cambio: ts,
      sin_datos: false,
    });
    const listados = await almacen.listarNodos();
    const mio = listados.find((n) => n._id.equals(nodo._id));
    expect(mio?.ultimo?.seq).toBe(7);
    expect(mio?.ultimo?.ts).toEqual(ts);

    await almacen.registrarEvento({
      nodo_id: nodo._id,
      comunidad_id: nodo.comunidad_id,
      ts,
      tipo: "sin_datos",
      severidad: "atencion",
      parametro: null,
      mensaje: "El nodo dejó de enviar datos.",
      datos: {},
      autor_uid: null,
    });
    expect(await mongo.db.collection("eventos").countDocuments({ nodo_id: nodo._id })).toBe(1);
  });
});
