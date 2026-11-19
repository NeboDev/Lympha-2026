import { cargarConfig } from "./config.ts";
import { crearAlertas } from "./modulos/alertas/index.ts";
import { crearApp } from "./modulos/api/index.ts";
import { crearIngesta, crearPoller } from "./modulos/ingesta/index.ts";
import { crearEnviador } from "./modulos/notificaciones/index.ts";
import { crearServicioReportes } from "./modulos/reportes/index.ts";
import { crearManejadorTelegram } from "./modulos/telegram/index.ts";
import { crearAlmacenAlertasMongo } from "./plataforma/almacen-alertas-mongo.ts";
import { crearAlmacenMongo } from "./plataforma/almacen-mongo.ts";
import { crearAlmacenReportesMongo } from "./plataforma/almacen-reportes-mongo.ts";
import { crearAlmacenTelegramMongo } from "./plataforma/almacen-telegram-mongo.ts";
import { blynkAlcanzable } from "./plataforma/blynk.ts";
import { crearBucle } from "./plataforma/bucle.ts";
import { cargarCatalogo } from "./plataforma/catalogo.ts";
import { crearVerificadorFirebase } from "./plataforma/firebase.ts";
import { crearGeneradorPdf } from "./plataforma/generador-reportes.ts";
import { crearLectorBlynk } from "./plataforma/lector-blynk.ts";
import { crearLogger } from "./plataforma/logger.ts";
import { cargarSimboloLympha } from "./plataforma/logo-svg.ts";
import { cargarMarca } from "./plataforma/marca.ts";
import { conectarMongo } from "./plataforma/mongo.ts";
import { crearServiciosApi } from "./plataforma/servicios-api.ts";
import { crearClienteTelegram } from "./plataforma/telegram-api.ts";
import { iniciarPolling } from "./plataforma/telegram-polling.ts";

const config = cargarConfig(process.env);
const logger = crearLogger();
const catalogo = cargarCatalogo();
const marca = cargarMarca();

// Sin el id del proyecto de Firebase no hay forma de saber quién es quién: la API no arranca.
if (!config.firebase) {
  throw new Error(
    "Falta FIREBASE_PROJECT_ID en .env (Configuración del proyecto > ID del proyecto)",
  );
}
if (config.firebase.usarEmulador) {
  logger.warn({}, "FIREBASE_USE_EMULATOR=true: se aceptan tokens sin firma (solo para desarrollo)");
}
if (!config.actuadorEscribeBlynk) {
  logger.warn({}, "ACTUADOR_ESCRIBE_BLYNK=false: el control del actuador no escribe en Blynk");
}
if (config.demoToken) {
  logger.warn({}, "Usuario de demostración ACTIVO: quien tenga USUARIO_DEMO_TOKEN entra como demo");
}

const mongo = await conectarMongo(config);
// Los servicios de la API se arman una vez: el control del actuador también lo usan la ingesta y el barrido.
const servicios = crearServiciosApi({
  db: mongo.db,
  catalogo,
  marca,
  verificador: crearVerificadorFirebase(config.firebase),
  // Por qué Firebase rechazó un token (otro proyecto, vencido…). Es el mensaje de Firebase, sin el token.
  alRechazarToken: (e) =>
    logger.warn(
      { causa: (e instanceof Error ? e.message : "error").slice(0, 240) },
      "Acceso: Firebase rechazó un token",
    ),
  demoToken: config.demoToken,
  claveCifrado: config.claveCifrado,
  blynkHost: config.blynkHost,
  logo: cargarSimboloLympha(),
  usuarioBot: config.telegramToken ? config.telegramUsuario : null,
  loggerControl: logger,
  // Con ACTUADOR_ESCRIBE_BLYNK=false se ensaya todo sin mover nada: la orden se registra pero no sale a Blynk.
  ...(config.actuadorEscribeBlynk
    ? {}
    : {
        escritorActuador: {
          async escribir(nodo: { _id: { toHexString(): string } }, pin: string, valor: 0 | 1) {
            logger.warn(
              { nodo_id: nodo._id.toHexString(), pin, valor },
              "ACTUADOR_ESCRIBE_BLYNK=false: la orden NO se mandó a Blynk",
            );
          },
        },
      }),
});
const app = crearApp({
  corsOrigenes: config.corsOrigenes,
  salud: {
    mongo: () => mongo.ping(),
    blynk: () => blynkAlcanzable(config.blynkHost),
  },
  servicios,
  logger,
});

// Alertas: se reconcilian tras cada muestra (ingesta) y en un barrido periódico (recordatorios).
const almacenAlertas = crearAlmacenAlertasMongo(mongo.db);
const alertas = crearAlertas({
  almacen: almacenAlertas,
  catalogo,
  marca,
  recordatorioMin: config.recordatorioMin,
  logger,
});
const barrido = crearBucle("barrido", () => alertas.barrido(), config.barridoMs, logger);
// Control del actuador: apaga los pulsos que llegaron a su fin y vence las solicitudes sin confirmar.
const barridoControl = crearBucle("control", () => servicios.control.barrido(), 2000, logger);

// Poller de Blynk → Mongo. Se puede apagar con INGESTA_ACTIVA=false (solo API).
const almacen = crearAlmacenMongo(mongo.db);
const poller = config.ingestaActiva
  ? crearPoller({
      ingesta: crearIngesta({
        almacen,
        lector: crearLectorBlynk({ clave: config.claveCifrado }),
        catalogo,
        sinDatosS: config.sinDatosS,
        alCambio: async (cambio) => {
          await alertas.sincronizar(cambio);
          // Regla de seguridad: si hay un pulso en curso y el agua sale de rango, se apaga.
          await servicios.control.reaccionar(cambio);
        },
        alCalibracion: async ({ nodo, pctNernst, ts }) => {
          await servicios.calibraciones.registrarReportada(nodo, pctNernst, ts);
        },
        logger,
      }),
      almacen,
      pollMs: config.pollMs,
      logger,
    })
  : null;

// Reportes PDF: el mismo generador lo usarán la API y la web (Pasos 7 y 9); Telegram es la segunda puerta.
const reportes = crearGeneradorPdf({
  servicio: crearServicioReportes({
    almacen: crearAlmacenReportesMongo(mongo.db),
    catalogo,
    marca,
  }),
  logo: cargarSimboloLympha(),
});

// Telegram: envío de avisos y atención del bot por long polling. Sin token, los avisos esperan en la bandeja.
let enviador: ReturnType<typeof crearBucle> | null = null;
let polling: Awaited<ReturnType<typeof iniciarPolling>> | null = null;
if (config.telegramToken && config.telegramUsuario) {
  const cliente = crearClienteTelegram(config.telegramToken);
  const enviar = crearEnviador({ almacen: almacenAlertas, telegram: cliente, logger });
  enviador = crearBucle("enviador", () => enviar.ronda(), 2000, logger);
  polling = await iniciarPolling({
    cliente,
    manejar: crearManejadorTelegram({
      almacen: crearAlmacenTelegramMongo(mongo.db),
      cliente,
      marca,
      catalogo,
      usuarioBot: config.telegramUsuario,
      reportes: {
        async generar(nodo, dias) {
          const r = await reportes.ultimosDias(nodo._id, dias, "Telegram");
          return { nombreArchivo: r.nombreArchivo, pdf: r.pdf };
        },
      },
      logger,
    }),
    logger,
  });
} else {
  logger.warn({}, "Telegram apagado: falta TELEGRAM_BOT_TOKEN; los avisos esperan en la bandeja");
}

async function apagar(senal: string) {
  logger.info({ senal }, "apagando");
  await polling?.detener();
  await enviador?.detener();
  await barridoControl.detener();
  await barrido.detener();
  await poller?.detener();
  await app.close();
  await mongo.cerrar();
  process.exit(0);
}
process.on("SIGINT", () => void apagar("SIGINT"));
process.on("SIGTERM", () => void apagar("SIGTERM"));

await app.listen({ port: config.puerto, host: "0.0.0.0" });
poller?.iniciar();
barrido.iniciar();
barridoControl.iniciar();
enviador?.iniciar();
logger.info(
  {
    puerto: config.puerto,
    env: config.appEnv,
    ingesta: config.ingestaActiva,
    telegram: polling !== null,
    poll_ms: config.pollMs,
  },
  "Atl listo",
);
