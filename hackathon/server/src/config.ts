import { z } from "zod";

/** Quita comillas y un comentario `# …` pegado al final del valor. */
function limpiar(valor: string | undefined): string | undefined {
  if (valor === undefined) return undefined;
  const sinComentario = valor.replace(/\s+#.*$/, "").trim();
  const sinComillas = sinComentario.replace(/^(["'])(.*)\1$/, "$2");
  return sinComillas === "" ? undefined : sinComillas;
}

const entero = (por_defecto: number) => z.coerce.number().int().positive().default(por_defecto);

const esquema = z
  .object({
    APP_ENV: z.enum(["local", "demo"]).default("local"),
    PORT: entero(3000),
    CORS_ORIGINS: z.string().default("http://localhost:5173"),
    MONGODB_URI: z
      .string({ required_error: "falta MONGODB_URI" })
      .regex(/^mongodb(\+srv)?:\/\//, "MONGODB_URI debe empezar con mongodb:// o mongodb+srv://"),
    MONGODB_DB: z.string().default("atl"),
    MONGODB_DNS: z.string().optional(),
    BLYNK_HOST: z.string().default("blynk.cloud"),
    POLL_MS: entero(5000),
    SIN_DATOS_S: entero(60),
    ATL_CLAVE_CIFRADO: z
      .string({ required_error: "falta ATL_CLAVE_CIFRADO" })
      .refine((s) => Buffer.from(s, "base64").length === 32, {
        message: "ATL_CLAVE_CIFRADO debe ser de 32 bytes en base64",
      }),
    INGESTA_ACTIVA: z.enum(["true", "false"]).default("true"),
    ACTUADOR_ESCRIBE_BLYNK: z.enum(["true", "false"]).default("true"),
    TELEGRAM_BOT_TOKEN: z
      .string()
      .regex(/^\d{6,12}:[A-Za-z0-9_-]{30,}$/, "TELEGRAM_BOT_TOKEN no parece un token de BotFather")
      .optional(),
    TELEGRAM_BOT_USERNAME: z
      .string()
      .regex(/^[A-Za-z0-9_]{5,32}$/, "TELEGRAM_BOT_USERNAME va sin @ (letras, números y _)")
      .optional(),
    RECORDATORIO_MIN: entero(30),
    BARRIDO_MS: entero(15000),
    FIREBASE_PROJECT_ID: z
      .string()
      .regex(
        /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/,
        "FIREBASE_PROJECT_ID no parece un id de proyecto de Firebase",
      )
      .optional(),
    FIREBASE_USE_EMULATOR: z.enum(["true", "false"]).default("false"),
    FIREBASE_AUTH_EMULATOR_HOST: z
      .string()
      .regex(/^[\w.-]+:\d{2,5}$/, "FIREBASE_AUTH_EMULATOR_HOST va como host:puerto")
      .default("127.0.0.1:9099"),
    USUARIO_DEMO_ACTIVO: z.enum(["true", "false"]).default("false"),
    USUARIO_DEMO_TOKEN: z
      .string()
      .min(16, "USUARIO_DEMO_TOKEN debe tener al menos 16 caracteres")
      .optional(),
  })
  .strict()
  .refine((e) => e.FIREBASE_USE_EMULATOR === "false" || e.APP_ENV === "local", {
    message: "el emulador de Firebase solo se permite con APP_ENV=local",
    path: ["FIREBASE_USE_EMULATOR"],
  })
  .refine((e) => e.USUARIO_DEMO_ACTIVO === "false" || e.APP_ENV === "demo", {
    message: "el usuario de demostración solo se permite con APP_ENV=demo",
    path: ["USUARIO_DEMO_ACTIVO"],
  })
  .refine((e) => e.USUARIO_DEMO_ACTIVO === "false" || !!e.USUARIO_DEMO_TOKEN, {
    message: "con USUARIO_DEMO_ACTIVO hace falta USUARIO_DEMO_TOKEN (un secreto de 16+ caracteres)",
    path: ["USUARIO_DEMO_TOKEN"],
  })
  .refine((e) => !e.TELEGRAM_BOT_TOKEN || !!e.TELEGRAM_BOT_USERNAME, {
    message: "con TELEGRAM_BOT_TOKEN hace falta TELEGRAM_BOT_USERNAME (para los enlaces)",
    path: ["TELEGRAM_BOT_USERNAME"],
  });

export type Config = {
  appEnv: "local" | "demo";
  puerto: number;
  corsOrigenes: string[];
  mongoUri: string;
  mongoDb: string;
  /** Servidores DNS alternos (p. ej. si el DNS local no resuelve los registros SRV de Atlas). */
  mongoDns: string[];
  blynkHost: string;
  pollMs: number;
  sinDatosS: number;
  /** Clave AES-256 (32 bytes) con la que se cifra el token de Blynk de cada nodo. */
  claveCifrado: Buffer;
  /** `false` levanta solo la API, sin el poller de Blynk. */
  ingestaActiva: boolean;
  /** `false`: el control del actuador ensaya todo el flujo pero NUNCA escribe en el pin del relevador. */
  actuadorEscribeBlynk: boolean;
  /** null = Telegram apagado: los avisos esperan en la bandeja. */
  telegramToken: string | null;
  telegramUsuario: string | null;
  /** Minutos entre recordatorios de una alerta abierta (la mitad si es crítica). */
  recordatorioMin: number;
  barridoMs: number;
  /** null = sin acceso configurado: la API no arranca (ver main.ts). */
  firebase: { projectId: string; usarEmulador: boolean; hostEmulador: string } | null;
  /** Token fijo del usuario de demostración (plan B del jueves); null = desactivado. */
  demoToken: string | null;
};

const CLAVES = [
  "APP_ENV",
  "PORT",
  "CORS_ORIGINS",
  "MONGODB_URI",
  "MONGODB_DB",
  "MONGODB_DNS",
  "BLYNK_HOST",
  "POLL_MS",
  "SIN_DATOS_S",
  "ATL_CLAVE_CIFRADO",
  "INGESTA_ACTIVA",
  "ACTUADOR_ESCRIBE_BLYNK",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "RECORDATORIO_MIN",
  "BARRIDO_MS",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_USE_EMULATOR",
  "FIREBASE_AUTH_EMULATOR_HOST",
  "USUARIO_DEMO_ACTIVO",
  "USUARIO_DEMO_TOKEN",
] as const;

/** Configuración mínima de las herramientas que solo hablan con Blynk (simulador): sin Mongo. */
export function cargarConfigBlynk(env: Record<string, string | undefined>) {
  const r = z
    .object({
      BLYNK_HOST: z.string().default("blynk.cloud"),
      BLYNK_TOKEN_PRUEBA: z
        .string({ required_error: "falta BLYNK_TOKEN_PRUEBA" })
        .min(10, "BLYNK_TOKEN_PRUEBA parece incompleto"),
    })
    .strict()
    .safeParse({
      BLYNK_HOST: limpiar(env.BLYNK_HOST),
      BLYNK_TOKEN_PRUEBA: limpiar(env.BLYNK_TOKEN_PRUEBA),
    });
  if (!r.success) {
    const problemas = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Configuración inválida: ${problemas.join("; ")}`);
  }
  return { blynkHost: r.data.BLYNK_HOST, blynkToken: r.data.BLYNK_TOKEN_PRUEBA };
}

/** Valida el entorno. Si falta o sobra algo, lanza un error con todos los problemas (sin valores). */
export function cargarConfig(env: Record<string, string | undefined>): Config {
  const entrada: Record<string, string | undefined> = {};
  for (const clave of CLAVES) entrada[clave] = limpiar(env[clave]);

  const resultado = esquema.safeParse(entrada);
  if (!resultado.success) {
    const problemas = resultado.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Configuración inválida: ${problemas.join("; ")}`);
  }
  const e = resultado.data;
  const lista = (s: string | undefined) =>
    (s ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

  return {
    appEnv: e.APP_ENV,
    puerto: e.PORT,
    corsOrigenes: lista(e.CORS_ORIGINS),
    mongoUri: e.MONGODB_URI,
    mongoDb: e.MONGODB_DB,
    mongoDns: lista(e.MONGODB_DNS),
    blynkHost: e.BLYNK_HOST,
    pollMs: e.POLL_MS,
    sinDatosS: e.SIN_DATOS_S,
    claveCifrado: Buffer.from(e.ATL_CLAVE_CIFRADO, "base64"),
    ingestaActiva: e.INGESTA_ACTIVA === "true",
    actuadorEscribeBlynk: e.ACTUADOR_ESCRIBE_BLYNK === "true",
    telegramToken: e.TELEGRAM_BOT_TOKEN ?? null,
    telegramUsuario: e.TELEGRAM_BOT_USERNAME ?? null,
    recordatorioMin: e.RECORDATORIO_MIN,
    barridoMs: e.BARRIDO_MS,
    firebase: e.FIREBASE_PROJECT_ID
      ? {
          projectId: e.FIREBASE_PROJECT_ID,
          usarEmulador: e.FIREBASE_USE_EMULATOR === "true",
          hostEmulador: e.FIREBASE_AUTH_EMULATOR_HOST,
        }
      : null,
    demoToken: e.USUARIO_DEMO_ACTIVO === "true" ? (e.USUARIO_DEMO_TOKEN ?? null) : null,
  };
}
