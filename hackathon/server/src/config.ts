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
] as const;

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
  };
}
