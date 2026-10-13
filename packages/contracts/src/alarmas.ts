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

/** Alarma tal como la ve la API (RF-32: estado y quién la atendió; solo el nombre, nunca el correo). */
export const alarmaApi = z.object({
  id: z.string().uuid(),
  nodo_id: z.string().uuid(),
  nodo_nombre: z.string().nullable(),
  espacio_id: z.string().uuid(),
  tipo: tipoAlarma,
  severidad: severidadAlarma,
  estado: estadoAlarma,
  causa: z.string().nullable(),
  abierta_en: z.string().datetime(),
  escalada_en: z.string().datetime().nullable(),
  atendida_por: z.object({ id: z.string().uuid(), nombre: z.string().nullable() }).nullable(),
  atendida_en: z.string().datetime().nullable(),
  resuelta_en: z.string().datetime().nullable(),
});
export type AlarmaApi = z.infer<typeof alarmaApi>;

export const listaAlarmasQuery = z
  .object({
    /** `abiertas` = activas y atendidas. Sin valor, todas. */
    estado: z.enum(["abiertas", ...ESTADOS_ALARMA]).optional(),
    limite: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export const listaAlarmasRespuesta = z.object({ alarmas: z.array(alarmaApi) });

/** Vinculación de Telegram por deep link (RF-26). */
export const vinculoTelegramRespuesta = z.object({
  /** `https://t.me/<bot>?start=<token>`; el token vale 10 min y un solo uso. */
  enlace: z.string().url(),
  expira_en: z.string().datetime(),
});
export const estadoTelegramApi = z.object({
  vinculado: z.boolean(),
  vinculado_en: z.string().datetime().nullable(),
});
export type EstadoTelegramApi = z.infer<typeof estadoTelegramApi>;

const esZonaHoraria = (z_: string): boolean => {
  try {
    new Intl.DateTimeFormat("es-MX", { timeZone: z_ });
    return true;
  } catch {
    return false;
  }
};

/** Preferencias de aviso (RF-31). `nodo_id` nulo = la preferencia por defecto del usuario. */
export const preferenciaNotificacion = z
  .object({
    nodo_id: z.string().uuid().nullable(),
    /** Niveles que avisan. Las alarmas de conexión y de sensor avisan siempre. */
    niveles: z
      .array(severidadAlarma)
      .max(3)
      .refine((n) => new Set(n).size === n.length, "niveles repetidos"),
    silencio_inicio: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM")
      .nullable(),
    silencio_fin: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM")
      .nullable(),
    zona_horaria: z.string().min(1).max(64).refine(esZonaHoraria, "zona horaria no válida"),
    /** Horas entre recordatorios mientras la alarma siga activa. */
    recordatorio_h: z.number().int().min(1).max(72),
  })
  .strict();
export type PreferenciaNotificacion = z.infer<typeof preferenciaNotificacion>;

export const preferenciaBody = preferenciaNotificacion.refine(
  (p) => (p.silencio_inicio === null) === (p.silencio_fin === null),
  { message: "el horario silencioso necesita inicio y fin", path: ["silencio_fin"] },
);
export const preferenciasRespuesta = z.object({
  defecto: preferenciaNotificacion,
  nodos: z.array(preferenciaNotificacion),
});

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
