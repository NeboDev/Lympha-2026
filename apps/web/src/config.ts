/** Configuración pública de la PWA (variables VITE_*; llegan al navegador, así que nunca llevan secretos). */

const DESARROLLO_API = "http://127.0.0.1:3000";

/** URL base de la API, sin barra final. */
export const API_URL: string = (import.meta.env.VITE_API_URL || DESARROLLO_API).replace(/\/+$/, "");
