import { z } from "zod";

/**
 * Eventos del stream SSE de un espacio (`GET .../espacios/:id/eventos`) y del canal `espacio:{id}`
 * de Valkey por el que el worker los publica. El cliente reemplaza el estado del nodo con cada evento.
 */

export const nivelApi = z.enum(["buena", "regular", "mala", "critica", "sin_datos"]);
export type NivelApi = z.infer<typeof nivelApi>;

export const confianzaApi = z.enum(["ok", "dudosa", "revisar"]);
export type ConfianzaApi = z.infer<typeof confianzaApi>;

export const valoresApi = z.object({
  ph: z.number().nullable(),
  temperatura: z.number().nullable(),
  conductividad: z.number().nullable(),
  turbidez: z.number().nullable(),
  tds: z.number().nullable(),
});
export type ValoresApi = z.infer<typeof valoresApi>;

/** Estado actual de un nodo: semáforo, WQI, causa y acción (RF-18, RF-20, RF-22). */
export const estadoNodoEvento = z.object({
  nodo_id: z.string().uuid(),
  espacio_id: z.string().uuid(),
  nivel: nivelApi,
  wqi: z.number().nullable(),
  confianza: confianzaApi,
  /** Parámetro responsable del nivel, o el sensor que hay que revisar. */
  parametro_limitante: z.string().nullable(),
  causa: z.string().nullable(),
  accion: z.string().nullable(),
  /** Hora de la última lectura evaluada (hora del nodo). */
  ultima_lectura_en: z.string().datetime().nullable(),
  valores: valoresApi.nullable(),
  actualizado_en: z.string().datetime(),
});
export type EstadoNodoEvento = z.infer<typeof estadoNodoEvento>;

export const NOMBRES_EVENTO_ESPACIO = ["snapshot", "estado", "alarma"] as const;

/**
 * El canal `espacio:{id}` lleva dos clases de mensaje: el estado de un nodo (`event: estado`) y un cambio de
 * alarma (`event: alarma`, ver `eventoAlarma`). Solo las alarmas traen `alarma_id`.
 */
export function nombreEventoEspacio(mensaje: string): "estado" | "alarma" {
  try {
    const dato: unknown = JSON.parse(mensaje);
    return typeof dato === "object" && dato !== null && "alarma_id" in dato ? "alarma" : "estado";
  } catch {
    return "estado";
  }
}

/** Primer evento de cada conexión: el estado de todos los nodos del espacio. */
export const eventoSnapshot = z.object({ nodos: z.array(estadoNodoEvento) });
export type EventoSnapshot = z.infer<typeof eventoSnapshot>;

/** Cambio de estado de un nodo (`event: estado`). */
export const eventoEstado = estadoNodoEvento;
export type EventoEstado = EstadoNodoEvento;

export const canalEspacio = (espacioId: string): string => `espacio:${espacioId}`;
