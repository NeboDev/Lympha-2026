import { randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AlertaDoc } from "../modulos/alertas/index.ts";
import { crearDocumentoNodo } from "../modulos/nodos/index.ts";
import type { AvisoDoc } from "../modulos/notificaciones/index.ts";
import { crearTokenVinculo } from "../modulos/telegram/index.ts";
import { crearAlmacenAlertasMongo } from "./almacen-alertas-mongo.ts";
import { crearAlmacenTelegramMongo } from "./almacen-telegram-mongo.ts";
import { cargarCatalogo } from "./catalogo.ts";
import { asegurarIndices } from "./indices.ts";
import { conectarMongo, type Mongo } from "./mongo.ts";

/**
 * Integración de alertas, bandeja de avisos y vinculación contra un Mongo real. Se omite salvo que
 * pongas ATL_TEST_MONGO=1 (ver almacen-mongo.int.test.ts). Usa una base temporal que borra al terminar.
 */
const activo = process.env.ATL_TEST_MONGO === "1" && !!process.env.MONGODB_URI;

describe.skipIf(!activo)("alertas, avisos y Telegram en Mongo (integración)", () => {
  let mongo: Mongo;
  const nombreDb = `atl_test_${randomBytes(4).toString("hex")}`;
  const ahora = () => new Date();

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

  const alerta = (
    nodo: ObjectId,
    comunidad: ObjectId,
    parte: Partial<AlertaDoc> = {},
  ): AlertaDoc => ({
    _id: new ObjectId(),
    nodo_id: nodo,
    comunidad_id: comunidad,
    tipo: "nivel",
    parametro: "ph",
    severidad: "alta",
    severidad_maxima: "alta",
    estado: "abierta",
    abierta: ahora(),
    cerrada: null,
    ultimo_aviso: null,
    recordatorios: 0,
    valor_apertura: 6.2,
    valor_cierre: null,
    ...parte,
  });

  const aviso = (comunidad: ObjectId, clave: string, parte: Partial<AvisoDoc> = {}): AvisoDoc => ({
    _id: new ObjectId(),
    clave,
    comunidad_id: comunidad,
    nodo_id: null,
    alerta_id: null,
    tipo: "abre",
    texto: "hola",
    creado: ahora(),
    estado: "pendiente",
    intentos: 0,
    proximo_intento: new Date(Date.now() - 1000),
    bloqueado_hasta: null,
    enviado: null,
    ultimo_error: null,
    ...parte,
  });

  it("solo puede haber una alerta abierta por (nodo, tipo, parámetro); cerrada, se puede abrir otra", async () => {
    const a = crearAlmacenAlertasMongo(mongo.db);
    const nodo = new ObjectId();
    const com = new ObjectId();
    const primera = alerta(nodo, com);
    expect(await a.insertarAlerta(primera)).toBe("insertada");
    expect(await a.insertarAlerta(alerta(nodo, com))).toBe("duplicada");
    // Otro parámetro o tipo sí cabe.
    expect(await a.insertarAlerta(alerta(nodo, com, { tipo: "sensor" }))).toBe("insertada");

    expect(await a.cerrarAlerta(primera._id, ahora(), 7.1)).toBe(true);
    expect(await a.cerrarAlerta(primera._id, ahora(), 7.1)).toBe(false); // ya estaba cerrada
    expect(await a.insertarAlerta(alerta(nodo, com))).toBe("insertada");
    expect((await a.alertasAbiertasDeNodo(nodo)).map((x) => x.tipo).sort()).toEqual([
      "nivel",
      "sensor",
    ]);
  });

  it("cambiarSeveridad es condicional: solo cambia si tenía la severidad esperada", async () => {
    const a = crearAlmacenAlertasMongo(mongo.db);
    const x = alerta(new ObjectId(), new ObjectId());
    await a.insertarAlerta(x);
    expect(await a.cambiarSeveridad(x._id, "alta", "critica", "critica")).toBe(true);
    expect(await a.cambiarSeveridad(x._id, "alta", "critica", "critica")).toBe(false);
    const [guardada] = await a.alertasAbiertasDeNodo(x.nodo_id);
    expect(guardada).toMatchObject({ severidad: "critica", severidad_maxima: "critica" });
  });

  it("marcarAviso anota el aviso y los recordatorios", async () => {
    const a = crearAlmacenAlertasMongo(mongo.db);
    const x = alerta(new ObjectId(), new ObjectId());
    await a.insertarAlerta(x);
    const t = ahora();
    await a.marcarAviso(x._id, t);
    await a.marcarAviso(x._id, t, 2);
    const [g] = await a.alertasAbiertasDeNodo(x.nodo_id);
    expect(g?.ultimo_aviso).toEqual(t);
    expect(g?.recordatorios).toBe(2);
  });

  it("la clave de un aviso es única", async () => {
    const a = crearAlmacenAlertasMongo(mongo.db);
    const com = new ObjectId();
    expect(await a.encolarAviso(aviso(com, "alerta-x:abre"))).toBe("encolado");
    expect(await a.encolarAviso(aviso(com, "alerta-x:abre"))).toBe("duplicado");
  });

  it("la bandeja: toma con arrendamiento, reprograma y marca enviado", async () => {
    const a = crearAlmacenAlertasMongo(mongo.db);
    // La bandeja es global: se parte de una vacía para no tomar avisos de otras pruebas.
    await mongo.db.collection("avisos").deleteMany({});
    const com = new ObjectId();
    await a.encolarAviso(aviso(com, "b1", { creado: new Date(Date.now() - 2000) }));
    await a.encolarAviso(aviso(com, "b2", { creado: new Date(Date.now() - 1000) }));

    const t = ahora();
    const primero = await a.tomarSiguiente(t, 30_000);
    expect(primero?.clave).toBe("b1"); // el más antiguo
    // Mientras está arrendado, otro proceso toma el siguiente, no el mismo.
    const segundo = await a.tomarSiguiente(t, 30_000);
    expect(segundo?.clave).toBe("b2");
    expect(await a.tomarSiguiente(t, 30_000)).toBeNull();

    // b2: enviado → ya no vuelve, ni aunque venza su arrendamiento.
    await a.marcarEnviado((segundo as AvisoDoc)._id, ahora());
    // b1: se reprograma al futuro → no se toma aunque venza su arrendamiento.
    await a.reprogramar((primero as AvisoDoc)._id, new Date(Date.now() + 60_000), "sin red");
    expect(await a.tomarSiguiente(new Date(Date.now() + 40_000), 30_000)).toBeNull();
    // Pasado el tiempo de espera, b1 vuelve a tocar.
    expect((await a.tomarSiguiente(new Date(Date.now() + 120_000), 30_000))?.clave).toBe("b1");

    const docs = await mongo.db
      .collection<AvisoDoc>("avisos")
      .find({ comunidad_id: com })
      .toArray();
    const b1 = docs.find((d) => d.clave === "b1");
    const b2 = docs.find((d) => d.clave === "b2");
    expect(b1).toMatchObject({ estado: "pendiente", intentos: 1, ultimo_error: "sin red" });
    expect(b2).toMatchObject({ estado: "enviado", intentos: 1 });
  });

  it("vinculación: token de un solo uso, un chat por comunidad, desvincular", async () => {
    const t = crearAlmacenTelegramMongo(mongo.db);
    const a = crearAlmacenAlertasMongo(mongo.db);
    const catalogo = cargarCatalogo();
    const c1 = new ObjectId();
    const c2 = new ObjectId();
    await mongo.db.collection("comunidades").insertMany([
      { _id: c1, nombre: "Primaria X", telegram: null },
      { _id: c2, nombre: "Comité del pozo", telegram: null },
    ]);
    await mongo.db.collection("nodos").insertOne({
      ...crearDocumentoNodo({
        comunidadId: c1,
        nombre: "Tinaco",
        tokenCifrado: "v1:a:b:c",
        host: "blynk.cloud",
        catalogo,
      }),
    });

    const { token } = await crearTokenVinculo(t, c1);
    expect(await t.canjearToken(token, ahora())).toEqual({ comunidad_id: c1 });
    expect(await t.canjearToken(token, ahora())).toBeNull(); // un solo uso

    const vencido = await crearTokenVinculo(t, c1, new Date(Date.now() - 11 * 60_000));
    expect(await t.canjearToken(vencido.token, ahora())).toBeNull();

    const chat = { chat_id: -4242, titulo: "Padres", tipo: "group", vinculado_por: 7 };
    expect(await t.vincularChat(c1, chat, ahora())).toEqual({
      resultado: "ok",
      comunidad: "Primaria X",
    });
    expect(await a.hayChat(c1)).toBe(true);
    expect(await a.chatDe(c1)).toBe(-4242);
    expect(await a.hayChat(c2)).toBe(false);
    // Otra comunidad no puede quedarse con el mismo chat.
    expect(await t.vincularChat(c2, chat, ahora())).toEqual({ resultado: "chat_ocupado" });
    expect(await t.vincularChat(new ObjectId(), chat, ahora())).toEqual({
      resultado: "comunidad_inexistente",
    });
    // La misma comunidad puede volver a vincular el mismo chat.
    expect((await t.vincularChat(c1, chat, ahora())).resultado).toBe("ok");

    expect(await t.comunidadDeChat(-4242)).toMatchObject({
      nombre: "Primaria X",
      vinculado_por: 7,
    });
    expect((await t.nodosDeComunidad(c1)).map((n) => n.nombre)).toEqual(["Tinaco"]);
    expect(await t.desvincularChat(-4242)).toBe(true);
    expect(await t.desvincularChat(-4242)).toBe(false);
    expect(await a.hayChat(c1)).toBe(false);
    // Ya libre, la otra comunidad puede tomarlo.
    expect((await t.vincularChat(c2, chat, ahora())).resultado).toBe("ok");
  });
});
