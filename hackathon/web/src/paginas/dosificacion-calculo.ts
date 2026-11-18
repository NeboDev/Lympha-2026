import type { Accion, EstadoAccion } from "../api/tipos.ts";
import { duracionCorta } from "../util/formato.ts";

/** Cómo se le llama a cada estado de una acción del actuador, en palabras de la gente. */
export const ETIQUETA_ACCION: Record<EstadoAccion, string> = {
  pendiente: "Esperando confirmación",
  en_curso: "En curso",
  terminada: "Terminada",
  detenida: "Detenida",
  cancelada: "Cancelada",
  expirada: "Venció sin confirmarse",
  rechazada: "Rechazada",
  fallida: "No se pudo enviar",
};

/**
 * Una línea para el historial: «Pulso de 20 s · Detenida por seguridad». Dice lo que pasó con la ORDEN: Atl no
 * ve si el relevador actuó, así que nunca afirma que se dosificó.
 */
export function describirAccion(
  a: Pick<Accion, "estado" | "duracion_s" | "automatica" | "simulado">,
): string {
  const base = `Pulso de ${duracionCorta(a.duracion_s)} · ${ETIQUETA_ACCION[a.estado]}`;
  const porSeguridad = a.estado === "detenida" && a.automatica ? " por seguridad" : "";
  return `${base}${porSeguridad}${a.simulado ? " (simulado)" : ""}`;
}

/** Un pulso vivo (pendiente o en curso) ocupa el actuador: no se puede pedir otro. */
export const estaViva = (a: Pick<Accion, "estado"> | null): boolean =>
  a?.estado === "pendiente" || a?.estado === "en_curso";
