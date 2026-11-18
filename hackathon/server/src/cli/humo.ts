import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ObjectId } from "mongodb";
import { cargarConfig, cargarConfigBlynk } from "../config.ts";
import {
  codigoDeSalida,
  ejecutarPasos,
  lineaDe,
  mensajeDe,
  type PasoHumo,
  resumenDe,
} from "../humo/corredor.ts";
import { crearAlertas } from "../modulos/alertas/index.ts";
import { crearApp, type ServiciosApi } from "../modulos/api/index.ts";
import { type AlmacenIngesta, crearIngesta, crearPoller } from "../modulos/ingesta/index.ts";
import { crearDocumentoNodo, mapeoPorDefecto, type NodoDoc } from "../modulos/nodos/index.ts";
import { crearAlmacenAlertasMongo } from "../plataforma/almacen-alertas-mongo.ts";
import { crearAlmacenMongo } from "../plataforma/almacen-mongo.ts";
import { crearClienteBlynk } from "../plataforma/blynk.ts";
import { cargarCatalogo } from "../plataforma/catalogo.ts";
import { cifrar } from "../plataforma/cifrado.ts";
import { nodosDelMismoDispositivo } from "../plataforma/dispositivo-compartido.ts";
import { crearLectorBlynk } from "../plataforma/lector-blynk.ts";
import { cargarSimboloLympha } from "../plataforma/logo-svg.ts";
import { cargarMarca } from "../plataforma/marca.ts";
import { conectarMongo } from "../plataforma/mongo.ts";
import { crearServiciosApi } from "../plataforma/servicios-api.ts";
import { crearClienteTelegram } from "../plataforma/telegram-api.ts";
import {
  duracionDe,
  esEscenario,
  muestra,
  NOMBRES_ESCENARIOS,
  type NombreEscenario,
} from "../simulador/escenarios.ts";

const AYUDA = `Prueba de humo de Atl: recorre la cadena completa con el simulador.
  simulador → Blynk → ingesta → MongoDB → alerta → API → reporte PDF (→ Telegram, si lo pides)

Uso: pnpm smoke [opciones]
  --comprobar            solo lee: configuración, MongoDB, Blynk, Telegram y nodos que comparten el
                         dispositivo. No escribe nada ni toca a nadie. Úsalo antes de correr el humo.
  --escenario <nombre>   ${NOMBRES_ESCENARIOS.join(" | ")} (por defecto: demo_limon)
  --velocidad <x>        comprime el tiempo del escenario (por defecto: 5)
  --intervalo-s <n>      cada cuántos segundos escribe el simulador en Blynk (por defecto: 1)
  --sondeo-s <n>         cada cuántos segundos lee la ingesta de Blynk (por defecto: 1)
                         Cada escritura y cada lectura es una llamada a la API de Blynk: súbelos para gastar menos.
                         Ejemplo ligero: --velocidad 10 --intervalo-s 2 --sondeo-s 2  (≈ 30–45 llamadas, ~1 min)
  --salida <carpeta>     dónde guardar el PDF de la prueba (por defecto: salida-humo)
  --conservar            no borra los datos de prueba al terminar (para mirarlos en la web)
  --aceptar-avisos       corre aunque haya otros nodos sobre el mismo dispositivo de Blynk (sus avisos
                         llegarán a su Telegram)
  --con-telegram         además manda un mensaje y el PDF al chat de --comunidad <id>

Crea una comunidad y un nodo de prueba, y los borra al terminar. Escribe en el dispositivo de Blynk de
BLYNK_TOKEN_PRUEBA y lo deja en calma (pH 7.2) al final. Los tokens nunca se imprimen.`;

const { values } = parseArgs({
  options: {
    comprobar: { type: "boolean", default: false },
    escenario: { type: "string", default: "demo_limon" },
    velocidad: { type: "string", default: "5" },
    "intervalo-s": { type: "string", default: "1" },
    "sondeo-s": { type: "string", default: "1" },
    salida: { type: "string", default: "salida-humo" },
    conservar: { type: "boolean", default: false },
    "aceptar-avisos": { type: "boolean", default: false },
    "con-telegram": { type: "boolean", default: false },
    comunidad: { type: "string" },
    ayuda: { type: "boolean", default: false },
  },
  strict: true,
});
if (values.ayuda) {
  console.log(AYUDA);
  process.exit(0);
}
const nombreEscenario = values.escenario ?? "demo_limon";
if (!esEscenario(nombreEscenario)) {
  console.error(`Escenario desconocido: ${nombreEscenario}.`);
  process.exit(2);
}
const escenario: NombreEscenario = nombreEscenario;
const velocidad = Number(values.velocidad);
if (!Number.isFinite(velocidad) || velocidad <= 0) {
  console.error("--velocidad debe ser un número positivo.");
  process.exit(2);
}
const intervaloS = Number(values["intervalo-s"]);
const sondeoS = Number(values["sondeo-s"]);
for (const [nombre, v] of [
  ["intervalo-s", intervaloS],
  ["sondeo-s", sondeoS],
] as const) {
  if (!Number.isFinite(v) || v < 1) {
    console.error(`--${nombre} debe ser un número de segundos (1 o más).`);
    process.exit(2);
  }
}
if (values["con-telegram"] && !(values.comunidad && ObjectId.isValid(values.comunidad))) {
  console.error("--con-telegram necesita --comunidad <id> (mira `pnpm telegram:estado`).");
  process.exit(2);
}
const comprobar = values.comprobar === true;

/* ---- Contexto compartido entre pasos ---- */
const config = cargarConfig(process.env);
const { blynkHost, blynkToken } = cargarConfigBlynk(process.env);
const catalogo = cargarCatalogo();
const marca = cargarMarca();
const mongo = await conectarMongo(config);
const blynk = crearClienteBlynk({ host: blynkHost });
const db = mongo.db;

const SILENCIO = { info() {}, warn() {}, error() {} };
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Espera hasta que `cond` sea cierta (revisándola cada 500 ms) o pase el tiempo. */
async function esperar<T>(
  cond: () => Promise<T | null | false>,
  ms: number,
  que: string,
): Promise<T> {
  const limite = Date.now() + ms;
  for (;;) {
    const r = await cond();
    if (r) return r;
    if (Date.now() >= limite) throw new Error(`no ocurrió en ${Math.round(ms / 1000)} s: ${que}`);
    await dormir(500);
  }
}

const estado: {
  comunidadId: ObjectId | null;
  nodo: NodoDoc | null;
  seq: number;
  escribioBlynk: boolean;
  poller: ReturnType<typeof crearPoller> | null;
  pdf: Buffer | null;
  nombrePdf: string;
  rutaPdf: string | null;
  servicios: ServiciosApi | null;
  secreto: string;
  /** Órdenes que el control quiso mandar al relevador: aquí solo se anotan, jamás salen a Blynk. */
  ordenes: { pin: string; valor: 0 | 1 }[];
  accionId: string | null;
} = {
  comunidadId: null,
  nodo: null,
  seq: 0,
  escribioBlynk: false,
  poller: null,
  pdf: null,
  nombrePdf: "reporte.pdf",
  rutaPdf: null,
  servicios: null,
  secreto: `humo-${randomBytes(18).toString("base64url")}`,
  ordenes: [],
  accionId: null,
};

const ph = catalogo.parametros.ph;
if (!ph?.norma || ph.norma.min === null || ph.norma.max === null) {
  throw new Error("El catálogo de pH debe traer norma con min y max");
}
const norma = { min: ph.norma.min, max: ph.norma.max };

async function escribirNodo(m: ReturnType<typeof muestra>): Promise<void> {
  const nodo = estado.nodo;
  if (!nodo) throw new Error("no hay nodo de prueba");
  const mapeo = nodo.blynk.mapeo;
  estado.seq++;
  await blynk.escribirPines(blynkToken, {
    [mapeo.valores.ph as string]: Number(m.ph.toFixed(2)),
    [mapeo.crudos.ph as string]: Number(m.phCrudo.toFixed(2)),
    [mapeo.estado]: m.estado,
    [mapeo.estable]: m.estable ? 1 : 0,
    [mapeo.seq]: estado.seq,
  });
  estado.escribioBlynk = true;
}

const pasos: PasoHumo[] = [
  {
    nombre: "Configuración",
    correr: async () =>
      `Blynk en ${blynkHost}; Mongo «${config.mongoDb}»; escenario ${escenario} ×${velocidad}`,
  },
  {
    nombre: "MongoDB",
    correr: async () => {
      if (!(await mongo.ping())) throw new Error("no responde");
      return `responde; ${await db.collection("nodos").countDocuments()} nodos guardados`;
    },
  },
  {
    nombre: "Blynk (solo lectura)",
    correr: async () => {
      const todo = await blynk.leerTodo(blynkToken);
      const previo = Number(todo[mapeoPorDefecto(catalogo, ["ph"]).seq]);
      estado.seq = Number.isFinite(previo) ? Math.max(0, Math.floor(previo)) : 0;
      return `${Object.keys(todo).length} pines; seq actual ${estado.seq}`;
    },
  },
  {
    nombre: "Telegram (el bot)",
    detieneSiFalla: false,
    omitir: () =>
      config.telegramToken ? null : "sin TELEGRAM_BOT_TOKEN (los avisos esperarían en la bandeja)",
    correr: async () => {
      const usuario = await crearClienteTelegram(config.telegramToken as string).obtenerNombreBot();
      if (
        config.telegramUsuario &&
        usuario.toLowerCase() !== config.telegramUsuario.toLowerCase()
      ) {
        throw new Error("el bot del token no es el de TELEGRAM_BOT_USERNAME");
      }
      return `@${usuario} responde`;
    },
  },
  {
    nombre: "Nodos sobre el mismo dispositivo",
    correr: async () => {
      const nodos = await db
        .collection<NodoDoc>("nodos")
        .find({ "blynk.token_cifrado": { $exists: true } })
        .toArray();
      const iguales = nodosDelMismoDispositivo(nodos, config.claveCifrado, blynkToken);
      if (iguales.length === 0) return "ninguno: nadie más reaccionará a lo que se escriba";
      const comunidades = db.collection<{ telegram?: { chat_id: number } | null }>("comunidades");
      const lista: string[] = [];
      let conTelegram = 0;
      for (const n of iguales) {
        const c = await comunidades.findOne({ _id: n.comunidad_id });
        if (c?.telegram) conTelegram++;
        lista.push(
          `«${n.nombre}» (${n._id.toHexString()}, Telegram ${c?.telegram ? "VINCULADO" : "sin vincular"})`,
        );
      }
      const texto = `${iguales.length} nodo(s) comparten el dispositivo: ${lista.join(", ")}`;
      // Sin Telegram vinculado nadie recibe avisos: con un servidor encendido, sus gráficas solo mostrarán la simulación.
      if (conTelegram === 0) {
        return `${texto}. Ninguno tiene Telegram: con un servidor encendido, sus gráficas mostrarán la simulación, pero nadie recibe avisos.`;
      }
      if (comprobar)
        return `${texto}. Un servidor encendido mandaría sus avisos a ese Telegram al correr el humo.`;
      if (values["aceptar-avisos"]) return `${texto}. Sigo porque pasaste --aceptar-avisos.`;
      throw new Error(
        `${texto}. Al simular la alarma, un servidor encendido mandaría los avisos de esos nodos a su Telegram. Bórralos (pnpm nodo:borrar), apaga el servidor o usa --aceptar-avisos.`,
      );
    },
  },
  {
    nombre: "Preparar la comunidad y el nodo de prueba",
    omitir: () => (comprobar ? "solo se comprueba (--comprobar)" : null),
    correr: async () => {
      const comunidadId = new ObjectId();
      await db.collection("comunidades").insertOne({
        _id: comunidadId,
        nombre: "Humo (se borra sola)",
        tipo: "otro",
        // `demo` es el uid del usuario de demostración: así la API de este humo lo ve como miembro.
        miembros: [{ uid: "demo", rol: "responsable" }],
        telegram: null,
        creado: new Date(),
      });
      estado.comunidadId = comunidadId;
      const nodo = crearDocumentoNodo({
        comunidadId,
        nombre: "Nodo de humo",
        tokenCifrado: cifrar(blynkToken, config.claveCifrado),
        host: blynkHost,
        catalogo,
      });
      await db.collection<NodoDoc>("nodos").insertOne(nodo);
      estado.nodo = nodo;
      // Servicios de la API (y del control del actuador) con un escritor que solo anota: el humo nunca mueve un relevador.
      estado.servicios = crearServiciosApi({
        db,
        catalogo,
        marca,
        verificador: {
          async verificar() {
            throw new Error("el humo solo entra con la cuenta de demostración");
          },
        },
        demoToken: estado.secreto,
        claveCifrado: config.claveCifrado,
        blynkHost,
        logo: cargarSimboloLympha(),
        usuarioBot: null,
        loggerControl: SILENCIO,
        escritorActuador: {
          async escribir(_nodo, pin, valor) {
            estado.ordenes.push({ pin, valor });
          },
        },
      });
      await estado.servicios.control.configurar("demo", nodo._id, {
        habilitado: true,
        nombre: "Bomba de prueba",
        pulso_max_s: 60,
        enfriamiento_s: 0,
        simulado: true,
        auto_detener: true,
      });
      return `comunidad ${comunidadId.toHexString()}, nodo ${nodo._id.toHexString()}`;
    },
  },
  {
    nombre: "Línea base en Blynk (pH 7.2 en calma)",
    omitir: () => (comprobar ? "solo se comprueba (--comprobar)" : null),
    correr: async () => {
      await escribirNodo(muestra("estable", 0, norma));
      return `seq ${estado.seq}`;
    },
  },
  {
    nombre: `Ingesta y alertas en marcha (cada ${sondeoS} s)`,
    omitir: () => (comprobar ? "solo se comprueba (--comprobar)" : null),
    correr: async () => {
      const nodo = estado.nodo as NodoDoc;
      const base = crearAlmacenMongo(db);
      // Solo el nodo de prueba: este humo no debe tocar a los demás nodos.
      const solo: AlmacenIngesta = {
        ...base,
        listarNodos: async () => (await base.listarNodos()).filter((n) => n._id.equals(nodo._id)),
      };
      const alertas = crearAlertas({
        almacen: crearAlmacenAlertasMongo(db),
        catalogo,
        marca,
        recordatorioMin: config.recordatorioMin,
        logger: SILENCIO,
      });
      estado.poller = crearPoller({
        ingesta: crearIngesta({
          almacen: solo,
          lector: crearLectorBlynk({ clave: config.claveCifrado }),
          catalogo,
          sinDatosS: config.sinDatosS,
          alCambio: async (c) => {
            await alertas.sincronizar(c);
            await (estado.servicios as ServiciosApi).control.reaccionar(c);
          },
          logger: SILENCIO,
        }),
        almacen: solo,
        pollMs: sondeoS * 1000,
        logger: SILENCIO,
      });
      estado.poller.iniciar();
      return "sondeando solo el nodo de prueba";
    },
  },
  {
    nombre: "Actuador simulado: pulso pedido y confirmado con el agua en rango",
    omitir: () => (comprobar ? "solo se comprueba (--comprobar)" : null),
    correr: async () => {
      const nodo = estado.nodo as NodoDoc;
      const control = (estado.servicios as ServiciosApi).control;
      await esperar(
        () => db.collection("nodos").findOne({ _id: nodo._id, ultimo: { $ne: null } }),
        30_000,
        "la primera lectura del nodo",
      );
      const accion = await control.solicitar("demo", nodo._id, {
        duracionS: 60,
        motivo: "prueba de humo",
      });
      if (accion.estado !== "pendiente") throw new Error(`quedó ${accion.estado}, no pendiente`);
      if (estado.ordenes.length > 0) throw new Error("pedir un pulso no debe mandar nada");
      const c = await control.confirmar("demo", nodo._id, new ObjectId(accion.id));
      estado.accionId = accion.id;
      if (c.estado !== "en_curso") throw new Error(`al confirmar quedó ${c.estado}`);
      if (estado.ordenes.length !== 1 || estado.ordenes[0]?.valor !== 1)
        throw new Error("al confirmar debía salir exactamente una orden de encendido");
      return "pedido (no manda nada), confirmado y orden de encendido anotada (simulada)";
    },
  },
  {
    nombre: `Simular «${escenario}» (×${velocidad})`,
    omitir: () => (comprobar ? "solo se comprueba (--comprobar)" : null),
    esperaMaxMs: 300_000,
    correr: async () => {
      const total = duracionDe(escenario) / velocidad + 4; // + unos segundos para que se vea el final
      const inicio = Date.now();
      let escrituras = 0;
      while ((Date.now() - inicio) / 1000 < total) {
        const t = ((Date.now() - inicio) / 1000) * velocidad;
        await escribirNodo(muestra(escenario, t, norma));
        escrituras++;
        await dormir(intervaloS * 1000);
      }
      return `${escrituras} escrituras en ${Math.round((Date.now() - inicio) / 1000)} s`;
    },
  },
  {
    nombre: "Muestras guardadas en MongoDB",
    omitir: () => (comprobar ? "solo se comprueba (--comprobar)" : null),
    correr: async () => {
      const nodo = estado.nodo as NodoDoc;
      const n = await esperar(
        async () => {
          const c = await db.collection("muestras").countDocuments({ nodo_id: nodo._id });
          return c >= 5 ? c : false;
        },
        30_000,
        "al menos 5 muestras del nodo",
      );
      return `${n} muestras`;
    },
  },
  {
    nombre: "Alerta de nivel (crítica) abierta",
    omitir: () => (comprobar ? "solo se comprueba (--comprobar)" : null),
    correr: async () => {
      const nodo = estado.nodo as NodoDoc;
      const a = await esperar(
        () =>
          db
            .collection("alertas")
            .findOne({ nodo_id: nodo._id, tipo: "nivel", severidad_maxima: "critica" }),
        30_000,
        "una alerta de nivel crítica",
      );
      return `abierta con pH ${a.valor_apertura ?? "—"}`;
    },
  },
  {
    nombre: "Actuador: el pulso se detuvo solo al salir de rango",
    omitir: () => (comprobar ? "solo se comprueba (--comprobar)" : null),
    correr: async () => {
      const nodo = estado.nodo as NodoDoc;
      const a = await esperar(
        () =>
          db.collection("acciones_actuador").findOne({
            nodo_id: nodo._id,
            estado: { $in: ["detenida", "terminada"] },
          }),
        20_000,
        "que el pulso termine o se detenga",
      );
      const ultima = estado.ordenes[estado.ordenes.length - 1];
      if (ultima?.valor !== 0) throw new Error("tras el pulso debía salir la orden de apagado");
      if (a.estado !== "detenida" || a.automatica !== true)
        throw new Error(`el pulso quedó «${a.estado}» y no lo detuvo la regla de seguridad`);
      return `detenida por la regla de seguridad; órdenes anotadas: ${estado.ordenes.map((o) => o.valor).join(" → ")} (ninguna salió a Blynk)`;
    },
  },
  {
    nombre: "Alerta cerrada al recuperarse el agua",
    omitir: () => (comprobar ? "solo se comprueba (--comprobar)" : null),
    esperaMaxMs: 90_000,
    correr: async () => {
      const nodo = estado.nodo as NodoDoc;
      const a = await esperar(
        () =>
          db.collection("alertas").findOne({ nodo_id: nodo._id, tipo: "nivel", estado: "cerrada" }),
        75_000,
        "que la alerta de nivel se cierre",
      );
      return `cerrada con pH ${a.valor_cierre ?? "—"}`;
    },
  },
  {
    nombre: "API: comunidad, nodo, serie, eventos y reporte PDF",
    omitir: () => (comprobar ? "solo se comprueba (--comprobar)" : null),
    correr: async () => {
      const nodo = estado.nodo as NodoDoc;
      const secreto = estado.secreto;
      const app = crearApp({
        corsOrigenes: [],
        salud: { mongo: () => mongo.ping(), blynk: async () => true },
        servicios: estado.servicios as ServiciosApi,
      });
      const pedir = (metodo: "GET" | "POST", url: string, payload?: object) =>
        app.inject({
          method: metodo,
          url,
          headers: { authorization: `Bearer ${secreto}` },
          ...(payload ? { payload } : {}),
        });
      try {
        const id = nodo._id.toHexString();
        const yo = await pedir("GET", "/api/yo");
        if (yo.statusCode !== 200 || yo.json().comunidades.length < 1)
          throw new Error(`/api/yo dio ${yo.statusCode}`);
        const det = await pedir("GET", `/api/nodos/${id}`);
        const d = det.json();
        if (det.statusCode !== 200 || typeof d.ultimo?.v?.ph !== "number")
          throw new Error("el nodo no trae su último pH");
        // Los últimos 10 minutos con paso de 5 s son 120 puntos como máximo: la API rechaza pedir más de 1000.
        const desde = encodeURIComponent(new Date(Date.now() - 10 * 60_000).toISOString());
        const serie = await pedir("GET", `/api/nodos/${id}/muestras?desde=${desde}&paso=5`);
        const cuerpoSerie = serie.json();
        const puntos = cuerpoSerie.puntos?.length ?? 0;
        if (serie.statusCode !== 200 || puntos < 3) {
          throw new Error(
            `la serie dio ${serie.statusCode}${cuerpoSerie.error ? ` (${cuerpoSerie.error})` : ""} y ${puntos} puntos`,
          );
        }
        const ev = await pedir("GET", `/api/nodos/${id}/eventos`);
        const alertas = ev.json().alertas?.length ?? 0;
        if (ev.statusCode !== 200 || alertas < 1) throw new Error("los eventos no traen la alerta");
        const rep = await pedir("POST", `/api/nodos/${id}/reportes`, { dias: 1 });
        if (rep.statusCode !== 200) throw new Error(`el reporte dio ${rep.statusCode}`);
        const pdf = rep.rawPayload;
        if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-")
          throw new Error("lo que devolvió no es un PDF");
        if (pdf.length < 5_000) throw new Error(`el PDF es muy chico (${pdf.length} bytes)`);
        const carpeta = resolve(values.salida ?? "salida-humo");
        await mkdir(carpeta, { recursive: true });
        estado.pdf = pdf;
        estado.nombrePdf = `humo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.pdf`;
        estado.rutaPdf = join(carpeta, estado.nombrePdf);
        await writeFile(estado.rutaPdf, pdf);
        return `pH ${d.ultimo.v.ph.toFixed(2)} (${d.conexion}); ${puntos} puntos; ${alertas} alerta(s); PDF de ${Math.round(pdf.length / 1024)} KB en ${estado.rutaPdf}`;
      } finally {
        await app.close();
      }
    },
  },
  {
    nombre: "Telegram: mensaje y PDF al chat",
    detieneSiFalla: false,
    omitir: () =>
      values["con-telegram"]
        ? null
        : "pídelo con --con-telegram --comunidad <id> (te llegará a ti)",
    correr: async () => {
      if (!config.telegramToken) throw new Error("falta TELEGRAM_BOT_TOKEN");
      const c = await db
        .collection<{ nombre: string; telegram?: { chat_id: number } | null }>("comunidades")
        .findOne({ _id: new ObjectId(values.comunidad) });
      if (!c?.telegram) throw new Error("esa comunidad no tiene un chat de Telegram vinculado");
      const bot = crearClienteTelegram(config.telegramToken);
      await bot.enviarMensaje(
        c.telegram.chat_id,
        `Prueba de humo de ${marca.nombre}: la cadena completa funcionó (simulador, Blynk, ingesta, alerta, API y reporte). Si lees esto, los avisos de «${c.nombre}» llegarán aquí.`,
      );
      if (!estado.pdf) throw new Error("no hay PDF que mandar");
      await bot.enviarDocumento(
        c.telegram.chat_id,
        { nombre: estado.nombrePdf, contenido: estado.pdf },
        "PDF de la prueba de humo.",
      );
      return `enviado a «${c.nombre}»`;
    },
  },
  {
    nombre: "Detener la ingesta",
    siempre: true,
    omitir: () => (estado.poller ? null : "no se había iniciado"),
    correr: async () => {
      await estado.poller?.detener();
      estado.poller = null;
      return undefined;
    },
  },
  {
    nombre: "Dejar el dispositivo de Blynk en calma",
    siempre: true,
    omitir: () => (estado.escribioBlynk ? null : "no se escribió nada en Blynk"),
    correr: async () => {
      await escribirNodo(muestra("estable", 0, norma));
      return "pH 7.2, estado 0";
    },
  },
  {
    nombre: "Borrar los datos de prueba",
    siempre: true,
    omitir: () => {
      if (!estado.nodo) return "no se creó nada";
      return values.conservar
        ? "pediste --conservar: quedan la comunidad «Humo (se borra sola)» y su nodo"
        : null;
    },
    correr: async () => {
      const nodo = estado.nodo as NodoDoc;
      let n = 0;
      for (const col of [
        "muestras",
        "alertas",
        "eventos",
        "calibraciones",
        "reportes",
        "acciones_actuador",
      ]) {
        n += (await db.collection(col).deleteMany({ nodo_id: nodo._id })).deletedCount;
      }
      n += (await db.collection("avisos").deleteMany({ comunidad_id: nodo.comunidad_id }))
        .deletedCount;
      await db.collection("nodos").deleteOne({ _id: nodo._id });
      await db.collection("comunidades").deleteOne({ _id: nodo.comunidad_id });
      await db.collection("usuarios").deleteMany({ google_uid: "demo" });
      return `${n} documentos de prueba y el nodo`;
    },
  },
];

console.log(`Prueba de humo de Atl${comprobar ? " (solo comprobar)" : ""}`);
if (!comprobar) {
  // Cada escritura y cada lectura es una llamada a la API de Blynk: se dice cuántas se esperan antes de gastarlas.
  const simulacionS = duracionDe(escenario) / velocidad + 4;
  const escrituras = Math.ceil(simulacionS / intervaloS) + 2; // + línea base y dejarlo en calma
  const lecturas = Math.ceil((simulacionS + 25) / sondeoS) + 1; // la ingesta sigue hasta que se cierra la alerta
  console.log(
    `Llamadas estimadas a Blynk: ≈ ${escrituras + lecturas} (${escrituras} escrituras + ${lecturas} lecturas); ` +
      `dura ≈ ${Math.round(simulacionS + 25)}–${Math.round(simulacionS + 90)} s.`,
  );
}
console.log("");
let resultados: Awaited<ReturnType<typeof ejecutarPasos>> = [];
try {
  resultados = await ejecutarPasos(pasos, { alTerminar: (r) => console.log(lineaDe(r)) });
} catch (e) {
  console.error(`El humo se interrumpió: ${mensajeDe(e)}`);
  process.exitCode = 1;
} finally {
  await mongo.cerrar();
}
console.log(`\n${resumenDe(resultados)}`);
if (estado.rutaPdf) console.log(`PDF de la prueba: ${estado.rutaPdf}`);
process.exitCode = process.exitCode ?? codigoDeSalida(resultados);
