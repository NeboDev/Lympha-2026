/** Configuración pública de la web (variables VITE_*; llegan al navegador, así que nunca llevan secretos). */

export type ConfigFirebase = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId?: string;
};

export type Config = {
  /** URL base de la API, sin barra final. */
  apiUrl: string;
  /** `null` si faltan datos de Firebase: la web lo dice y no ofrece el acceso con Google. */
  firebase: ConfigFirebase | null;
  /** Token del usuario de demostración (plan B), o `null`. */
  demoToken: string | null;
  /** Qué falta (nombres de variable, nunca valores). Vacío = completa. */
  problemas: string[];
};

type Entorno = Record<string, string | undefined>;

const DESARROLLO_API = "http://localhost:3000";

const limpio = (v: string | undefined): string => (v ?? "").trim();

export function leerConfig(env: Entorno, desarrollo: boolean): Config {
  const apiUrl = (limpio(env.VITE_API_URL) || (desarrollo ? DESARROLLO_API : "")).replace(
    /\/+$/,
    "",
  );
  const apiKey = limpio(env.VITE_FIREBASE_API_KEY);
  const projectId = limpio(env.VITE_FIREBASE_PROJECT_ID);
  const authDomain =
    limpio(env.VITE_FIREBASE_AUTH_DOMAIN) || (projectId ? `${projectId}.firebaseapp.com` : "");
  const appId = limpio(env.VITE_FIREBASE_APP_ID);
  const demoToken = limpio(env.VITE_DEMO_TOKEN) || null;

  const problemas: string[] = [];
  if (!apiUrl) problemas.push("VITE_API_URL");
  if (!apiKey) problemas.push("VITE_FIREBASE_API_KEY");
  if (!projectId) problemas.push("VITE_FIREBASE_PROJECT_ID");

  const firebase =
    apiKey && projectId ? { apiKey, authDomain, projectId, ...(appId ? { appId } : {}) } : null;
  return { apiUrl, firebase, demoToken, problemas };
}

export const CONFIG: Config = leerConfig(import.meta.env, import.meta.env.DEV);
