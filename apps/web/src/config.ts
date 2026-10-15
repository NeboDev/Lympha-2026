import type { ConfigFirebase } from "./sesion/firebase.ts";

/** Configuración pública de la PWA (variables VITE_*; llegan al navegador, así que nunca llevan secretos). */

const DESARROLLO_API = "http://127.0.0.1:3000";
const DESARROLLO_EMULADOR = "127.0.0.1:9099";
const DESARROLLO_PROYECTO = "lympha-dev";

type Entorno = Record<string, string | undefined>;

/**
 * Configuración de Firebase a partir de las variables VITE_*. El emulador de Auth solo se usa en desarrollo
 * (`desarrollo = true`): en un build de producción se ignora aunque la variable esté definida, para que un token
 * sin firma nunca sea el camino de acceso de nadie.
 */
export function resolverConfigFirebase(env: Entorno, desarrollo: boolean): ConfigFirebase {
  const proyecto = env.VITE_FIREBASE_PROJECT_ID || (desarrollo ? DESARROLLO_PROYECTO : "");
  const emulador = desarrollo
    ? env.VITE_FIREBASE_AUTH_EMULATOR === "off"
      ? undefined
      : env.VITE_FIREBASE_AUTH_EMULATOR || DESARROLLO_EMULADOR
    : undefined;
  return {
    // El emulador no valida la llave; la del proyecto real es pública por diseño de Firebase.
    apiKey: env.VITE_FIREBASE_API_KEY || (emulador ? "emulador" : ""),
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || (proyecto ? `${proyecto}.firebaseapp.com` : ""),
    projectId: proyecto,
    emulador,
  };
}

/** URL base de la API, sin barra final. */
export const API_URL: string = (import.meta.env.VITE_API_URL || DESARROLLO_API).replace(/\/+$/, "");

export const FIREBASE: ConfigFirebase = resolverConfigFirebase(
  import.meta.env,
  import.meta.env.DEV,
);
