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
  })
  .strict();

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
  };
}
