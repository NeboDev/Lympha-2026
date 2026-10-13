/**
 * Qué hacer con un aviso cuando Telegram no lo aceptó. Funciones puras (el enviador solo ejecuta la decisión).
 *
 * Espera creciente de 30 s, 2 min, 10 min y 1 h; al sexto intento fallido el aviso queda `fallida` y se
 * registra como error para la alerta interna (documento de datos, "Consumo en notifier").
 */

export const ESPERAS_S = [30, 120, 600, 3600] as const;
export const INTENTOS_MAXIMOS = 6;

export type Decision =
  | { tipo: "reintentar"; esperaS: number }
  | { tipo: "fallida"; motivo: string }
  /** El usuario ya no puede recibir mensajes: se borra su vínculo y sus avisos pendientes se descartan. */
  | { tipo: "descartar"; motivo: string };

const CHAT_PERDIDO =
  /chat not found|user is deactivated|bot was blocked|bot was kicked|chat was deleted/i;

/** Sin respuesta (red, tiempo agotado), token mal puesto, límite de Telegram o falla de Telegram: vale la pena reintentar. */
function esReintentable(codigo: number | undefined): boolean {
  return (
    codigo === undefined ||
    codigo === 401 ||
    codigo === 408 ||
    codigo === 409 ||
    codigo === 429 ||
    codigo >= 500
  );
}

/**
 * `intentos` cuenta el que acaba de fallar. `reintentarEnS` es lo que pidió Telegram en un 429.
 */
export function decidirTrasError(
  intentos: number,
  codigo: number | undefined,
  descripcion: string,
  reintentarEnS?: number,
): Decision {
  if (codigo === 403 || (codigo === 400 && CHAT_PERDIDO.test(descripcion))) {
    return { tipo: "descartar", motivo: "chat_no_disponible" };
  }
  if (!esReintentable(codigo)) return { tipo: "fallida", motivo: `rechazado_${codigo}` };
  if (intentos >= INTENTOS_MAXIMOS) return { tipo: "fallida", motivo: "intentos_agotados" };
  const base = ESPERAS_S[Math.min(Math.max(intentos, 1), ESPERAS_S.length) - 1] as number;
  return { tipo: "reintentar", esperaS: Math.max(base, reintentarEnS ? reintentarEnS + 1 : 0) };
}
