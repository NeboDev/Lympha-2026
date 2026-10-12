import type { FastifyInstance } from "fastify";
import { rutasSalud } from "../modules/salud/index.ts";
import { rutasDevTelemetria } from "../modules/telemetria/index.ts";
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
}

/** Único lugar donde se registran rutas: lo usa la API real y la prueba de cobertura de aislamiento. */
export async function registrarRutas(app: FastifyInstance, deps: DepsRutas, log: Logger) {
  await app.register(rutasSalud, {
    bd: deps.bd,
    valkey: deps.valkey,
    mqtt: deps.mqtt,
    version: deps.version,
  });
  if (deps.appEnv === "local") {
    await app.register(rutasDevTelemetria, { bd: deps.bd });
    log.warn("rutas /dev/* habilitadas (solo APP_ENV=local)");
  }
}

/** Construye la API sin abrir el puerto (las pruebas usan `app.inject`). */
export async function crearApi(config: ConfigDe<"api">, log: Logger): Promise<Api> {
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

  const app = crearServidorHttp(log);
  await registrarRutas(
    app,
    { bd, valkey, mqtt, version: config.APP_VERSION, appEnv: config.APP_ENV },
    log,
  );

  return {
    app,
    async cerrar() {
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
