import type { FastifyInstance } from "fastify";
import { rutasDispositivos } from "../modules/dispositivos/index.ts";
import { rutasEspacios } from "../modules/espacios/index.ts";
import {
  crearAutenticador,
  crearVerificadorFirebase,
  prepararEntornoFirebase,
  rutasIdentidad,
  type VerificadorToken,
} from "../modules/identidad/index.ts";
import { rutasSalud } from "../modules/salud/index.ts";
import {
  crearClienteTelegram,
  iniciarTelegram,
  type ManejadorActualizacion,
  type ModoTelegram,
  manejadorBasico,
  modoTelegram,
  rutaWebhookTelegram,
} from "../modules/telegram/index.ts";
import { rutasTelemetria } from "../modules/telemetria/index.ts";
import { type ConfigDe, cargarConfigOSalir } from "../platform/config.ts";
import { type BdApp, crearBdApp } from "../platform/db.ts";
import { crearServidorHttp } from "../platform/http.ts";
import { crearLogger, type Logger } from "../platform/logger.ts";
import {
  cerrarCliente,
  crearClienteMqtt,
  esperarConexion,
  type MqttClient,
} from "../platform/mqtt.ts";
import { alApagar } from "../platform/proceso.ts";
import { crearValkey, type Redis } from "../platform/valkey.ts";

export interface Api {
  app: FastifyInstance;
  cerrar(): Promise<void>;
}

export interface DepsRutas {
  bd: BdApp;
  valkey: Redis;
  mqtt: MqttClient;
  version: string;
  appEnv: "local" | "staging" | "production";
  verificador: VerificadorToken;
  claimPepper: string;
  /** Webhook de Telegram: solo existe si Telegram está en modo webhook. */
  telegram?: { secreto: string; manejar: ManejadorActualizacion };
}

/** Único lugar donde se registran rutas: lo usa la API real y la prueba de cobertura de aislamiento. */
export async function registrarRutas(app: FastifyInstance, deps: DepsRutas, _log: Logger) {
  const autenticar = crearAutenticador(deps.verificador, deps.bd);
  await app.register(rutasSalud, {
    bd: deps.bd,
    valkey: deps.valkey,
    mqtt: deps.mqtt,
    version: deps.version,
  });
  await app.register(rutasIdentidad, { bd: deps.bd, autenticar });
  await app.register(rutasEspacios, { bd: deps.bd, autenticar });
  await app.register(rutasDispositivos, {
    bd: deps.bd,
    valkey: deps.valkey,
    autenticar,
    claimPepper: deps.claimPepper,
  });
  await app.register(rutasTelemetria, { bd: deps.bd, autenticar });
  if (deps.telegram) await app.register(rutaWebhookTelegram, deps.telegram);
}

/** Construye la API sin abrir el puerto (las pruebas usan `app.inject`). */
export async function crearApi(
  config: ConfigDe<"api">,
  log: Logger,
  ajustes: { verificador?: VerificadorToken; fetchTelegram?: typeof fetch } = {},
): Promise<Api> {
  const bd = crearBdApp(config.DATABASE_URL_APP);
  const valkey = crearValkey(config.VALKEY_URL, "api");
  // api publica config/cmd a los nodos como "control"; el id de cliente es único por proceso.
  const mqtt = crearClienteMqtt({
    url: config.MQTT_URL,
    username: config.MQTT_CONTROL_USER,
    password: config.MQTT_CONTROL_PASSWORD,
    clientId: `${config.MQTT_CONTROL_USER}-api`,
    caFile: config.MQTT_CA_FILE,
  });
  mqtt.on("error", (e) => log.error({ err: e }, "MQTT"));
  mqtt.on("reconnect", () => log.warn("MQTT: reconectando"));
  // No se bloquea el arranque si el broker aún no está: /health reportará "degradado".
  esperarConexion(mqtt).catch((e: unknown) => log.warn({ err: e }, "MQTT: aún sin conexión"));

  prepararEntornoFirebase(config);
  if (config.FIREBASE_USE_EMULATOR) {
    log.warn(
      { emulador: config.FIREBASE_AUTH_EMULATOR_HOST },
      "Firebase Auth: EMULADOR (solo local)",
    );
  } else {
    log.info({ proyecto: config.FIREBASE_PROJECT_ID }, "Firebase Auth: proyecto real");
  }
  const verificador =
    ajustes.verificador ??
    crearVerificadorFirebase({
      projectId: config.FIREBASE_PROJECT_ID,
      exigirCorreoVerificado: config.APP_ENV !== "local",
      cuentaServicio: config.FIREBASE_USE_EMULATOR ? undefined : config.FIREBASE_SERVICE_ACCOUNT,
    });

  const modo: ModoTelegram = modoTelegram({
    appEnv: config.APP_ENV,
    token: config.TELEGRAM_BOT_TOKEN,
    publicApiUrl: config.PUBLIC_API_URL,
  });
  const manejar = manejadorBasico(log);

  const app = crearServidorHttp(log);
  await registrarRutas(
    app,
    {
      bd,
      valkey,
      mqtt,
      version: config.APP_VERSION,
      appEnv: config.APP_ENV,
      verificador,
      claimPepper: config.CLAIM_PEPPER,
      ...(modo === "webhook" && config.TELEGRAM_WEBHOOK_SECRET
        ? { telegram: { secreto: config.TELEGRAM_WEBHOOK_SECRET, manejar } }
        : {}),
    },
    log,
  );

  let telegram: Awaited<ReturnType<typeof iniciarTelegram>> | null = null;
  if (config.TELEGRAM_BOT_TOKEN && modo !== "desactivado") {
    // Un fallo de Telegram no debe impedir que la API arranque: se registra y se sigue sin el bot.
    telegram = await iniciarTelegram({
      modo,
      cliente: crearClienteTelegram(config.TELEGRAM_BOT_TOKEN, ajustes.fetchTelegram),
      manejar,
      log,
      publicApiUrl: config.PUBLIC_API_URL,
      webhookSecret: config.TELEGRAM_WEBHOOK_SECRET,
    }).catch((e: unknown) => {
      log.error({ err: e }, "Telegram: no se pudo iniciar; la API sigue sin el bot");
      return null;
    });
  } else {
    log.info("Telegram: desactivado (sin TELEGRAM_BOT_TOKEN)");
  }

  return {
    app,
    async cerrar() {
      await telegram?.detener();
      await app.close();
      await cerrarCliente(mqtt).catch(() => mqtt.end(true));
      valkey.disconnect();
      await bd.cerrar();
    },
  };
}

if (import.meta.main) {
  const config = cargarConfigOSalir("api");
  const log = crearLogger("api", config.LOG_LEVEL);
  const api = await crearApi(config, log);
  alApagar(log, api.cerrar);
  await api.app.listen({ port: config.PORT, host: config.HOST });
}
