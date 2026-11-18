import { randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccionDoc } from "../modulos/control/index.ts";
import { crearControl } from "../modulos/control/index.ts";
import { crearDocumentoNodo } from "../modulos/nodos/index.ts";
import { crearAlmacenControlMongo } from "./almacen-control-mongo.ts";
import { cargarCatalogo } from "./catalogo.ts";
import { asegurarIndices } from "./indices.ts";
import { conectarMongo, type Mongo } from "./mongo.ts";

/**
 * Integración del control del actuador contra un Mongo real. Se omite salvo que pongas ATL_TEST_MONGO=1.
 * Usa una base temporal que borra al terminar. NO escribe en Blynk: el escritor es un doble.
 */
const activo = process.env.ATL_TEST_MONGO === "1" && !!process.env.MONGODB_URI;

describe.skipIf(!activo)("control del actuador en Mongo (integración)", () => {
  let mongo: Mongo;
  const nombreDb = `atl_test_${randomBytes(4).toString("hex")}`;
  const catalogo = cargarCatalogo();

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

  const accion = (nodo: ObjectId, parte: Partial<AccionDoc> = {}): AccionDoc => ({
    _id: new ObjectId(),
    nodo_id: nodo,
    comunidad_id: new ObjectId(),
    tipo: "pulso",
    duracion_s: 10,
    estado: "pendiente",
    solicitada: new Date(),
    solicita_uid: "ana",
    expira: new Date(Date.now() + 120_000),
    motivo: null,
    confirmada: null,
    confirma_uid: null,
    inicio: null,
    fin: null,
    detalle: null,
    automatica: false,
    simulado: true,
    ...parte,
  });

  it("solo una acción viva (pendiente o en curso) por nodo; terminada, ya cabe otra", async () => {
    const a = crearAlmacenControlMongo(mongo.db);
    const nodo = new ObjectId();
    const primera = accion(nodo);
    expect(await a.insertar(primera)).toBe("insertada");
    expect(await a.insertar(accion(nodo))).toBe("ocupado");
    // Otro nodo no se ve afectado.
    expect(await a.insertar(accion(new ObjectId()))).toBe("insertada");
    expect((await a.activa(nodo))?._id.equals(primera._id)).toBe(true);

    await a.transicion(primera._id, ["pendiente"], { estado: "cancelada" });
    expect(await a.activa(nodo)).toBeNull();
    expect(await a.insertar(accion(nodo))).toBe("insertada");
  });

  it("la transición es condicional: solo gana una de dos confirmaciones simultáneas", async () => {
    const a = crearAlmacenControlMongo(mongo.db);
    const x = accion(new ObjectId());
    await a.insertar(x);
    const cambios = {
      estado: "en_curso" as const,
      confirma_uid: "ana",
      inicio: new Date(),
      fin: new Date(Date.now() + 10_000),
    };
    const [r1, r2] = await Promise.all([
      a.transicion(x._id, ["pendiente"], cambios),
      a.transicion(x._id, ["pendiente"], { ...cambios, confirma_uid: "otra" }),
    ]);
    expect([r1, r2].filter(Boolean)).toHaveLength(1);
    const guardada = await a.obtener(x._id, x.nodo_id);
    expect(guardada?.estado).toBe("en_curso");
    // Una transición desde un estado que ya no es el actual no cambia nada.
    expect(await a.transicion(x._id, ["pendiente"], { estado: "cancelada" })).toBeNull();
    expect((await a.obtener(x._id, x.nodo_id))?.estado).toBe("en_curso");
    // Una acción de otro nodo no se ve.
    expect(await a.obtener(x._id, new ObjectId())).toBeNull();
  });

  it("ultimoFin solo cuenta pulsos que llegaron a mandarse (terminada o detenida)", async () => {
    const a = crearAlmacenControlMongo(mongo.db);
    const nodo = new ObjectId();
    const base = Date.now(); // fijo: si se calculara en cada llamada, las fechas no coincidirían
    const t = (s: number) => new Date(base - s * 1000);
    await a.insertar(accion(nodo, { estado: "fallida", fin: t(10) }));
    await a.insertar(accion(nodo, { estado: "rechazada", fin: t(5) }));
    expect(await a.ultimoFin(nodo)).toBeNull();
    await a.insertar(accion(nodo, { estado: "terminada", fin: t(100) }));
    await a.insertar(accion(nodo, { estado: "detenida", fin: t(60) }));
    expect((await a.ultimoFin(nodo))?.getTime()).toBe(t(60).getTime());
  });

  it("vencidas devuelve pendientes sin confirmar a tiempo y pulsos que llegaron a su fin, no los demás", async () => {
    const a = crearAlmacenControlMongo(mongo.db);
    const n1 = new ObjectId();
    const n2 = new ObjectId();
    const n3 = new ObjectId();
    const n4 = new ObjectId();
    const ayer = new Date(Date.now() - 86_400_000);
    const pendienteVencida = accion(n1, { expira: ayer });
    const enCursoVencido = accion(n2, { estado: "en_curso", inicio: ayer, fin: ayer });
    const enCursoVigente = accion(n3, {
      estado: "en_curso",
      inicio: new Date(),
      fin: new Date(Date.now() + 60_000),
    });
    const pendienteVigente = accion(n4);
    for (const x of [pendienteVencida, enCursoVencido, enCursoVigente, pendienteVigente])
      await a.insertar(x);
    const ids = (await a.vencidas(new Date())).map((x) => x._id.toHexString());
    expect(ids).toContain(pendienteVencida._id.toHexString());
    expect(ids).toContain(enCursoVencido._id.toHexString());
    expect(ids).not.toContain(enCursoVigente._id.toHexString());
    expect(ids).not.toContain(pendienteVigente._id.toHexString());
  });

  it("recientes va de la más nueva a la más vieja", async () => {
    const a = crearAlmacenControlMongo(mongo.db);
    const nodo = new ObjectId();
    await a.insertar(accion(nodo, { estado: "terminada", solicitada: new Date(1000) }));
    await a.insertar(accion(nodo, { estado: "cancelada", solicitada: new Date(3000) }));
    await a.insertar(accion(nodo, { estado: "expirada", solicitada: new Date(2000) }));
    expect((await a.recientes(nodo, 10)).map((x) => x.estado)).toEqual([
      "cancelada",
      "expirada",
      "terminada",
    ]);
    expect(await a.recientes(nodo, 1)).toHaveLength(1);
  });

  it("de punta a punta con el servicio real: configurar, pedir, confirmar, apagar al terminar y dejar el enfriamiento", async () => {
    const comunidadId = new ObjectId();
    const nodo = crearDocumentoNodo({
      comunidadId,
      nombre: "Tinaco",
      tokenCifrado: "v1:a:b:c",
      host: "blynk.cloud",
      catalogo,
    });
    nodo.ultimo = {
      ts: new Date(),
      v: { ph: 7.2 },
      estado: "en_rango",
      estados: {},
      seq: 1,
      sesion: 0,
      estable: true,
      ultimo_cambio: new Date(),
      sin_datos: false,
    };
    await mongo.db.collection("nodos").insertOne(nodo);
    const escrituras: { pin: string; valor: number }[] = [];
    let ahora = Date.now();
    const almacen = crearAlmacenControlMongo(mongo.db);
    const control = crearControl({
      almacen,
      escritor: {
        async escribir(_n, pin, valor) {
          escrituras.push({ pin, valor });
        },
      },
      nodos: {
        async acceso() {
          const n = await almacen.nodo(nodo._id);
          return { nodo: n as never, rol: "responsable", comunidad: {} as never };
        },
      },
      reloj: () => new Date(ahora),
    });

    const cfg = {
      habilitado: true,
      nombre: "Bomba de cloro",
      pulso_max_s: 30,
      enfriamiento_s: 300,
      simulado: true,
      auto_detener: true,
    };
    expect((await control.configurar("ana", nodo._id, cfg)).actuador?.pin).toBe("v8");
    expect((await mongo.db.collection("nodos").findOne({ _id: nodo._id }))?.actuador).toMatchObject(
      { simulado: true },
    );

    const p = await control.solicitar("ana", nodo._id, { duracionS: 10 });
    expect(escrituras).toEqual([]);
    await control.confirmar("ana", nodo._id, new ObjectId(p.id));
    expect(escrituras).toEqual([{ pin: "v8", valor: 1 }]);

    ahora += 11_000;
    await control.barrido();
    expect(escrituras.at(-1)).toEqual({ pin: "v8", valor: 0 });
    const hecho = await mongo.db
      .collection("acciones_actuador")
      .findOne({ _id: new ObjectId(p.id) });
    expect(hecho?.estado).toBe("terminada");
    // El enfriamiento ya corre.
    await expect(control.solicitar("ana", nodo._id, { duracionS: 10 })).rejects.toMatchObject({
      codigo: "bloqueado",
    });
    // Y quedó registro en la línea de tiempo.
    const eventos = await mongo.db
      .collection("eventos")
      .find({ nodo_id: nodo._id, tipo: "actuador" })
      .sort({ ts: 1 })
      .toArray();
    expect(eventos.map((e) => e.datos.estado)).toEqual(["en_curso", "terminada"]);
  }, 60_000);
});
