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

/**
 * Conexión de un nodo con el broker (RF-13): el nodo se cayó (`conectado: false`, incluido el Last Will) o volvió.
 * Va aparte del estado de calidad porque cambia por otras causas y a otro ritmo (no depende de las lecturas).
 */
export const conexionNodo = z.object({
  nodo_id: z.string().uuid(),
  conectado: z.boolean(),
  /** Cuándo cambió la conexión (hora en que el servidor lo supo); `null` si el nodo nunca se ha conectado. */
  cambio_conexion_en: z.string().datetime().nullable(),
});
export type ConexionNodo = z.infer<typeof conexionNodo>;

/** Cambio de conexión de un nodo (`event: conexion`). */
export const eventoConexion = conexionNodo.extend({
  espacio_id: z.string().uuid(),
  cambio_conexion_en: z.string().datetime(),
  actualizado_en: z.string().datetime(),
});
export type EventoConexion = z.infer<typeof eventoConexion>;

export const NOMBRES_EVENTO_ESPACIO = [
  "snapshot",
  "estado",
  "alarma",
  "conexion",
  "calibracion",
] as const;

/**
 * El canal `espacio:{id}` lleva tres clases de mensaje: el estado de calidad de un nodo (`event: estado`), un
 * cambio de alarma (`event: alarma`, ver `eventoAlarma`, trae `alarma_id`) y un cambio de conexión
 * (`event: conexion`, trae `conectado`) y un cambio de calibración (`event: calibracion`, trae `calibracion_id`). El estado de calidad no trae ninguna de las dos claves.
 */
export function nombreEventoEspacio(
  mensaje: string,
): "estado" | "alarma" | "conexion" | "calibracion" {
  try {
    const dato: unknown = JSON.parse(mensaje);
    if (typeof dato !== "object" || dato === null) return "estado";
    if ("alarma_id" in dato) return "alarma";
    if ("calibracion_id" in dato) return "calibracion";
    return "conectado" in dato ? "conexion" : "estado";
  } catch {
    return "estado";
  }
}

/**
 * Primer evento de cada conexión: el estado de todos los nodos del espacio y su conexión. `conexiones` es
 * aditivo: un cliente anterior que no lo conoce lo ignora.
 */
export const eventoSnapshot = z.object({
  nodos: z.array(estadoNodoEvento),
  conexiones: z.array(conexionNodo).default([]),
});
export type EventoSnapshot = z.infer<typeof eventoSnapshot>;

/** Cambio de estado de un nodo (`event: estado`). */
export const eventoEstado = estadoNodoEvento;
export type EventoEstado = EstadoNodoEvento;

export const canalEspacio = (espacioId: string): string => `espacio:${espacioId}`;
