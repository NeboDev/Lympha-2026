import { z } from "zod";

/**
 * Configuración validada con Zod al arrancar. Cada proceso declara solo las variables que usa;
 * si falta alguna, el proceso no inicia. Los mensajes de error nunca incluyen valores.
 */

const comun = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  APP_ENV: z.enum(["local", "staging", "production"]),
  LOG_LEVEL: z.enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  /** SHA del commit con el que se construyó la imagen (lo inyecta el despliegue). */
  APP_VERSION: z.string().default("dev"),
});

const urlPostgres = z.string().regex(/^postgres(ql)?:\/\//, "debe ser una URL postgres://");
const urlValkey = z.string().regex(/^rediss?:\/\//, "debe ser una URL redis://");
const urlMqtt = z.string().regex(/^mqtts?:\/\//, "debe ser una URL mqtt:// o mqtts://");
const secreto = z.string().min(1);
const archivoCa = z.string().min(1).optional();
/** Una variable opcional vacía (`VAR=`) cuenta como ausente: así Compose puede pasarla sin valor. */
const opcional = <T extends z.ZodTypeAny>(esquema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), esquema.optional());
/** `true`/`false` (vacío o ausente = false). Cualquier otro texto es un error, no un `false` silencioso. */
const booleano = z.preprocess(
  (v) =>
    v === undefined || v === "" ? undefined : v === "true" ? true : v === "false" ? false : v,
  z.boolean().default(false),
);
/**
 * Lista de orígenes separados por coma (`https://app.lympha.app`), sin ruta ni barra final y sin comodín:
 * CORS solo responde a lo que se enumera aquí. Vacío o ausente = ninguno.
 */
const origenesCors = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v
          .split(",")
          .map((o) => o.trim())
          .filter((o) => o !== "")
      : v,
  z
    .array(
      z.string().refine((o) => {
        try {
          return new URL(o).origin === o && /^https?:$/.test(new URL(o).protocol);
        } catch {
          return false;
        }
      }, "debe ser un origen http(s) sin ruta ni barra final, p. ej. https://app.lympha.app"),
    )
    .default([]),
);
const puertoMetricas = opcional(z.coerce.number().int().min(1).max(65535));

const cuentaServicio = z
  .object({
    project_id: z.string().min(1),
    client_email: z.string().email(),
    private_key: z.string().min(1),
  })
  .passthrough();
export type CuentaServicio = z.infer<typeof cuentaServicio>;

/**
 * Lee la cuenta de servicio de Firebase (JSON o base64 de ese JSON). Los motivos de error nunca incluyen el
 * contenido: es un secreto.
 */
export function parsearCuentaServicio(
  valor: string,
): { ok: true; cuenta: CuentaServicio } | { ok: false; motivo: string } {
  const texto = valor.trim().startsWith("{")
    ? valor.trim()
    : Buffer.from(valor.trim(), "base64").toString("utf8");
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    return { ok: false, motivo: "no es un JSON (ni su base64) válido" };
  }
  const r = cuentaServicio.safeParse(json);
  if (!r.success) return { ok: false, motivo: "le faltan project_id, client_email o private_key" };
  return { ok: true, cuenta: r.data };
}

const esquemas = {
  api: comun
    .extend({
      PORT: z.coerce.number().int().min(1).max(65535).default(3000),
      HOST: z.string().default("0.0.0.0"),
      DATABASE_URL_APP: urlPostgres,
      VALKEY_URL: urlValkey,
      MQTT_URL: urlMqtt,
      MQTT_CA_FILE: archivoCa,
      MQTT_CONTROL_USER: z.string().min(1),
      MQTT_CONTROL_PASSWORD: secreto,
      CLAIM_PEPPER: secreto,
      /** Proyecto de Firebase cuyos tokens se aceptan (lympha-dev en local). */
      FIREBASE_PROJECT_ID: z.string().min(1),
      /**
       * `true` = tokens del emulador de Auth (sin firma). Solo APP_ENV=local. `false` = proyecto real
       * (FIREBASE_PROJECT_ID), con la firma verificada contra las llaves públicas de Google.
       */
      FIREBASE_USE_EMULATOR: booleano,
      /**
       * Cuenta de servicio del proyecto (JSON o ese JSON en base64). Opcional: verificar tokens no la necesita;
       * se reserva para operaciones de administración de Firebase. Se ignora con el emulador. Es un secreto.
       */
      FIREBASE_SERVICE_ACCOUNT: opcional(z.string().min(1)),
      /** Dirección del emulador (host:puerto); solo se usa con FIREBASE_USE_EMULATOR=true. */
      FIREBASE_AUTH_EMULATOR_HOST: opcional(
        z.string().regex(/^[\w.-]+:\d+$/, "debe ser host:puerto"),
      ),
      /** Orígenes de la PWA a los que CORS responde (separados por coma). Fuera de local, solo https. */
      CORS_ORIGINS: origenesCors,
      /** URL pública de la API. Define el modo de Telegram: con ella, webhook; sin ella (solo local), long polling. */
      PUBLIC_API_URL: opcional(z.string().url()),
      TELEGRAM_BOT_TOKEN: opcional(secreto),
      TELEGRAM_WEBHOOK_SECRET: opcional(
        z.string().regex(/^[A-Za-z0-9_-]{16,256}$/, "16 a 256 caracteres A-Za-z0-9_-"),
      ),
    })
    .superRefine((c, ctx) => {
      const problema = (path: string, message: string) =>
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
      if (c.FIREBASE_USE_EMULATOR && c.APP_ENV !== "local") {
        problema("FIREBASE_USE_EMULATOR", "solo se permite con APP_ENV=local");
      }
      if (c.FIREBASE_AUTH_EMULATOR_HOST && c.APP_ENV !== "local") {
        problema("FIREBASE_AUTH_EMULATOR_HOST", "solo se permite con APP_ENV=local");
      }
      if (c.FIREBASE_USE_EMULATOR && !c.FIREBASE_AUTH_EMULATOR_HOST) {
        problema(
          "FIREBASE_AUTH_EMULATOR_HOST",
          "falta: FIREBASE_USE_EMULATOR=true necesita host:puerto",
        );
      }
      if (c.FIREBASE_SERVICE_ACCOUNT && !c.FIREBASE_USE_EMULATOR) {
        const r = parsearCuentaServicio(c.FIREBASE_SERVICE_ACCOUNT);
        if (!r.ok) problema("FIREBASE_SERVICE_ACCOUNT", r.motivo);
        else if (r.cuenta.project_id !== c.FIREBASE_PROJECT_ID) {
          problema("FIREBASE_SERVICE_ACCOUNT", "es de otro proyecto que FIREBASE_PROJECT_ID");
        }
      }
      if (c.APP_ENV !== "local" && c.CORS_ORIGINS.some((o) => !o.startsWith("https://"))) {
        problema("CORS_ORIGINS", "fuera de local deben ser https://");
      }
      if (c.APP_ENV !== "local" && c.PUBLIC_API_URL && !c.PUBLIC_API_URL.startsWith("https://")) {
        problema("PUBLIC_API_URL", "fuera de local debe ser https://");
      }
      if (c.TELEGRAM_BOT_TOKEN && c.APP_ENV !== "local" && !c.PUBLIC_API_URL) {
        problema("PUBLIC_API_URL", "falta: Telegram usa webhook fuera de local");
      }
      if (c.TELEGRAM_BOT_TOKEN && c.PUBLIC_API_URL && !c.TELEGRAM_WEBHOOK_SECRET) {
        problema("TELEGRAM_WEBHOOK_SECRET", "falta: es obligatorio cuando Telegram usa webhook");
      }
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
    /** Puerto del endpoint /metrics (Prometheus). Sin valor, no se abre. */
    METRICS_PORT: puertoMetricas,
  }),
  worker: comun.extend({
    DATABASE_URL_SYSTEM: urlPostgres,
    VALKEY_URL: urlValkey,
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(1).default(1),
    METRICS_PORT: puertoMetricas,
    /** Cada cuánto corre el barrido de alarmas (desconexión, reconexión y recordatorios). */
    BARRIDO_MS: z.coerce.number().int().min(100).default(15_000),
    /**
     * Sustituye el tiempo sin conexión de los perfiles (`perfiles_uso.reglas_alarma`, 10 min por defecto en
     * `cisterna`). Para pruebas y demostraciones; en producción se deja sin definir.
     */
    ALARMA_SIN_CONEXION_S: opcional(z.coerce.number().int().min(1)),
  }),
  notifier: comun.extend({
    DATABASE_URL_SYSTEM: urlPostgres,
    NOTIFIER_POLL_MS: z.coerce.number().int().min(100).default(2000),
    /** Sin token el notifier no envía (y no reclama avisos, para no gastar sus intentos). */
    TELEGRAM_BOT_TOKEN: opcional(secreto),
    METRICS_PORT: puertoMetricas,
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
  /** CLI de fábrica: altas de lotes y nodos (rol lympha_owner) y sus clientes en Dynamic Security. */
  fabrica: comun.extend({
    DATABASE_URL_MIGRATE: urlPostgres,
    MQTT_URL: urlMqtt,
    MQTT_CA_FILE: archivoCa,
    MQTT_ADMIN_USER: z.string().min(1),
    MQTT_ADMIN_PASSWORD: secreto,
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
