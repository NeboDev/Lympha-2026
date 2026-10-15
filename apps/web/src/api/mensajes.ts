import { ErrorApi, SinConexion } from "./cliente.ts";

const POR_CODIGO: Record<string, string> = {
  reclamo_invalido:
    "No pudimos reclamar ese nodo. Revisa el identificador y el código de la etiqueta; un nodo que ya reclamó alguien no se puede reclamar otra vez.",
  invitacion_invalida:
    "La invitación no es válida o ya venció. Pide una nueva a quien administra el espacio.",
  limite_espacios: "Ya alcanzaste el máximo de espacios.",
  transferir_primero: "Transfiere la propiedad de este espacio antes de salir.",
  demasiadas_solicitudes: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
  prohibido: "No tienes permiso para hacer esto.",
  no_encontrado: "No encontramos lo que buscas.",
  no_autenticado: "Tu sesión no es válida. Vuelve a entrar.",
  conflicto: "Algo cambió mientras tanto. Recarga e inténtalo de nuevo.",
  invalido: "Revisa los datos e inténtalo de nuevo.",
};

/** Mensaje en español para un error de la API o de red. Nunca muestra códigos internos ni trazas. */
export function mensajeDeError(error: unknown): string {
  if (error instanceof SinConexion) {
    return "No hay conexión con Lympha. Revisa tu red e inténtalo de nuevo.";
  }
  if (error instanceof ErrorApi) {
    return POR_CODIGO[error.codigo] ?? "Algo salió mal. Inténtalo de nuevo.";
  }
  return "Algo salió mal. Inténtalo de nuevo.";
}
