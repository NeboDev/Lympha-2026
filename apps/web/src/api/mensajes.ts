import { ErrorApi, SinConexion } from "./cliente.ts";

const POR_CODIGO: Record<string, string> = {
  reclamo_invalido:
    "No pudimos reclamar ese nodo. Revisa el identificador y el código de la etiqueta; un nodo que ya reclamó alguien no se puede reclamar otra vez.",
  invitacion_invalida:
    "La invitación no es válida o ya venció. Pide una nueva a quien administra el espacio.",
  limite_espacios: "Ya alcanzaste el máximo de espacios.",
  transferir_primero: "Transfiere la propiedad de este espacio antes de salir.",
  demasiadas_solicitudes: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
  telegram_no_disponible:
    "Los avisos por Telegram no están disponibles en este momento. Inténtalo más tarde.",
  alarma_no_activa: "Esa alerta ya fue atendida o resuelta por alguien más.",
  puntos_repetidos:
    "El sensor midió lo mismo en todos los puntos, así que no se puede calcular la calibración. Revisa que la sonda esté dentro de cada solución.",
  puntos_insuficientes: "Se necesitan al menos dos puntos para calibrar.",
  valor_invalido: "Alguno de los valores capturados no es un número válido.",
  pendiente_no_positiva:
    "El sensor responde al revés de lo esperado. Revisa la sonda y los valores de las soluciones.",
  regeneracion_invalida:
    "Solo se regenera la etiqueta de un nodo sin reclamar y de un lote vigente. Si ya está reclamado, desvincúlalo primero.",
  servicio_no_disponible:
    "El servidor no puede hacer esto ahora (falta el acceso de administración al broker). No se cambió nada.",
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
