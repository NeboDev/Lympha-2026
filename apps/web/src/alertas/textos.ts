import type { AlarmaApi, EstadoAlarma, SeveridadAlarma, TipoAlarma } from "@lympha/contracts";

/** Etiquetas en español de lo que dice la API sobre una alarma (RF-32). Nada afirma que el agua sea «potable» ni «segura». */

export const ETIQUETA_TIPO: Record<TipoAlarma, string> = {
  nivel: "Calidad del agua",
  sin_conexion: "Sin conexión",
  sensor: "Sensor por revisar",
};

export const ETIQUETA_SEVERIDAD: Record<SeveridadAlarma, string> = {
  regular: "Regular",
  mala: "Mala",
  critica: "Crítica",
};

export const SIMBOLO_SEVERIDAD: Record<SeveridadAlarma, string> = {
  regular: "!",
  mala: "▲",
  critica: "✕",
};

export const ETIQUETA_ESTADO: Record<EstadoAlarma, string> = {
  activa: "Activa",
  atendida: "Atendida",
  resuelta: "Resuelta",
};

/** Una línea que dice qué pasó y qué es esta alarma: «Calidad del agua: Crítica», «Sin conexión». */
export function titulo(a: Pick<AlarmaApi, "tipo" | "severidad">): string {
  return a.tipo === "nivel"
    ? `${ETIQUETA_TIPO.nivel}: ${ETIQUETA_SEVERIDAD[a.severidad]}`
    : ETIQUETA_TIPO[a.tipo];
}

/** «Atendida por Ana el 14 oct, 10:32»; para las demás, cuándo se abrió o se resolvió. */
export function lineaDeEstado(a: AlarmaApi): string {
  const cuando = (iso: string) =>
    new Date(iso).toLocaleString("es-MX", {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  if (a.estado === "resuelta" && a.resuelta_en) return `Resuelta el ${cuando(a.resuelta_en)}`;
  if (a.estado === "atendida" && a.atendida_en) {
    const quien = a.atendida_por?.nombre ?? "alguien del espacio";
    return `Atendida por ${quien} el ${cuando(a.atendida_en)}`;
  }
  return `Abierta el ${cuando(a.abierta_en)}`;
}
