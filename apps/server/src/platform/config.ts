import { z } from "zod";

/**
 * Configuración validada con Zod al arrancar. Cada proceso declara solo las variables que usa;
 * si falta alguna, el proceso no inicia. Los mensajes de error nunca incluyen valores.
 */

const comun = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  APP_ENV: z.enum(["local", "staging", "production"]),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

const urlPostgres = z.string().regex(/^postgres(ql)?:\/\//, "debe ser una URL postgres://");
const urlValkey = z.string().regex(/^rediss?:\/\//, "debe ser una URL redis://");
const urlMqtt = z.string().regex(/^mqtts?:\/\//, "debe ser una URL mqtt:// o mqtts://");
const secreto = z.string().min(1);
const archivoCa = z.string().min(1).optional();

const esquemas = {
  api: comun.extend({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().default("0.0.0.0"),
    DATABASE_URL_APP: urlPostgres,
    VALKEY_URL: urlValkey,
    MQTT_URL: urlMqtt,
    MQTT_CA_FILE: archivoCa,
    MQTT_CONTROL_USER: z.string().min(1),
    MQTT_CONTROL_PASSWORD: secreto,
    CLAIM_PEPPER: secreto,
  }),
  ingest: comun.extend({
    DATABASE_URL_SYSTEM: urlPostgres,
    VALKEY_URL: urlValkey,
    MQTT_URL: urlMqtt,
    MQTT_CA_FILE: archivoCa,
    MQTT_INGEST_USER: z.string().min(1),
    MQTT_INGEST_PASSWORD: secreto,
    INGEST_BATCH_MS: z.coerce.number().int().min(1).max(5000).default(200),
    INGEST_BATCH_MAX: z.coerce.number().int().min(1).max(500).default(500),
  }),
  worker: comun.extend({
    DATABASE_URL_SYSTEM: urlPostgres,
    VALKEY_URL: urlValkey,
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(1).default(1),
  }),
  notifier: comun.extend({
    DATABASE_URL_SYSTEM: urlPostgres,
    NOTIFIER_POLL_MS: z.coerce.number().int().min(100).default(2000),
  }),
  migrate: comun.extend({
    DATABASE_URL_MIGRATE: urlPostgres,
  }),
  seed: comun.extend({
    DATABASE_URL_MIGRATE: urlPostgres,
    MQTT_URL: urlMqtt,
    MQTT_CA_FILE: archivoCa,
    MQTT_ADMIN_USER: z.string().min(1),
    MQTT_ADMIN_PASSWORD: secreto,
    DEV_NODO_ID: z.string().uuid(),
    DEV_NODO_PASSWORD: secreto,
    DEV_NODO_CODIGO: secreto,
    CLAIM_PEPPER: secreto,
  }),
  "mqtt-bootstrap": comun.extend({
    MQTT_URL: urlMqtt,
    MQTT_CA_FILE: archivoCa,
    MQTT_ADMIN_USER: z.string().min(1),
    MQTT_ADMIN_PASSWORD: secreto,
    MQTT_INGEST_USER: z.string().min(1),
    MQTT_INGEST_PASSWORD: secreto,
    MQTT_CONTROL_USER: z.string().min(1),
    MQTT_CONTROL_PASSWORD: secreto,
  }),
} as const;

export type Proceso = keyof typeof esquemas;
export type ConfigDe<P extends Proceso> = z.infer<(typeof esquemas)[P]>;

export class ConfigInvalida extends Error {
  readonly problemas: string[];
  constructor(proceso: string, problemas: string[]) {
    super(`Configuración inválida para "${proceso}": ${problemas.join("; ")}`);
    this.name = "ConfigInvalida";
    this.problemas = problemas;
  }
}

export function cargarConfig<P extends Proceso>(
  proceso: P,
  env: Record<string, string | undefined> = process.env,
): ConfigDe<P> {
  const esquema = esquemas[proceso] as unknown as z.ZodType<ConfigDe<P>>;
  const resultado = esquema.safeParse(env);
  if (!resultado.success) {
    const problemas = resultado.error.issues.map((i) => {
      const campo = i.path.join(".") || "(raíz)";
      const falta = i.code === "invalid_type" && i.received === "undefined";
      return `${campo}: ${falta ? "falta" : i.message}`;
    });
    throw new ConfigInvalida(proceso, problemas);
  }
  return resultado.data;
}

/** Para entrypoints: imprime el problema (sin valores) y termina con código 1. */
export function cargarConfigOSalir<P extends Proceso>(proceso: P): ConfigDe<P> {
  try {
    return cargarConfig(proceso);
  } catch (error) {
    if (error instanceof ConfigInvalida) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
