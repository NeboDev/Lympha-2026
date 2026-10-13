import { z } from "zod";

/**
 * Alarmas y avisos. Una alarma es un problema con principio y fin (no un evento por lectura): se abre,
 * escala, mejora y se resuelve. Los avisos de Telegram salen de la bandeja `notificaciones_salida`.
 */

export const TIPOS_ALARMA = ["nivel", "sin_conexion", "sensor"] as const;
export const tipoAlarma = z.enum(TIPOS_ALARMA);
export type TipoAlarma = z.infer<typeof tipoAlarma>;

export const ESTADOS_ALARMA = ["activa", "atendida", "resuelta"] as const;
export const estadoAlarma = z.enum(ESTADOS_ALARMA);
export type EstadoAlarma = z.infer<typeof estadoAlarma>;

/** Una alarma de nivel nace en `regular` o peor; `buena` y `sin_datos` no son severidades. */
export const SEVERIDADES_ALARMA = ["regular", "mala", "critica"] as const;
export const severidadAlarma = z.enum(SEVERIDADES_ALARMA);
export type SeveridadAlarma = z.infer<typeof severidadAlarma>;

/** Eventos de la bandeja de salida (`app.notificaciones_salida.evento`). */
export const EVENTOS_AVISO = [
  "abierta",
  "escalada",
  "mejorada",
  "resuelta",
  "recordatorio",
  "sin_conexion",
  "reconectado",
] as const;
export const eventoAviso = z.enum(EVENTOS_AVISO);
export type EventoAviso = z.infer<typeof eventoAviso>;

/** Qué le pasó a la alarma (`event: alarma` del stream SSE del espacio). */
export const CAMBIOS_ALARMA = ["abierta", "escalada", "mejorada", "atendida", "resuelta"] as const;
export const cambioAlarma = z.enum(CAMBIOS_ALARMA);
export type CambioAlarma = z.infer<typeof cambioAlarma>;

export const eventoAlarma = z.object({
  alarma_id: z.string().uuid(),
  nodo_id: z.string().uuid(),
  espacio_id: z.string().uuid(),
  tipo: tipoAlarma,
  severidad: severidadAlarma,
  estado: estadoAlarma,
  cambio: cambioAlarma,
  causa: z.string().nullable(),
  abierta_en: z.string().datetime(),
  actualizado_en: z.string().datetime(),
});
export type EventoAlarma = z.infer<typeof eventoAlarma>;
