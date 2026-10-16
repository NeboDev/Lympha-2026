import { z } from "zod";

/** Una lectura ya validada y asignada a su espacio, tal como viaja por la cola `lecturas`. */
export const lecturaTrabajo = z.object({
  nodoId: z.string().uuid(),
  espacioId: z.string().uuid(),
  /** Hora del nodo, en milisegundos Unix. */
  ts: z.number().int().positive(),
  seq: z.number().int().nonnegative(),
  ph: z.number().nullable(),
  temperatura: z.number().nullable(),
  conductividad: z.number().nullable(),
  turbidez: z.number().nullable(),
  tds: z.number().nullable(),
  /** Hora en que `ingest` aceptó el mensaje, en milisegundos Unix. */
  recibidoEn: z.number().int().positive(),
});
export type LecturaTrabajo = z.infer<typeof lecturaTrabajo>;

/** Un trabajo de la cola: una o más lecturas. El worker las agrupa en lotes de hasta 500 filas. */
export const trabajoLecturas = z.object({
  lecturas: z.array(lecturaTrabajo).min(1).max(500),
});
export type TrabajoLecturas = z.infer<typeof trabajoLecturas>;

/**
 * Hechos del nodo que no son lecturas y viajan por la misma cola (`lecturas`), en el orden en que llegaron:
 * un cambio de conexión (Last Will `offline` incluido) los atributos que el nodo publica al conectar o la respuesta a un comando (`cmd/ack`).
 */
export const eventoNodo = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("estado"),
    nodoId: z.string().uuid(),
    espacioId: z.string().uuid(),
    estado: z.enum(["online", "offline"]),
    /** Hora en que `ingest` recibió el mensaje, en milisegundos Unix. */
    recibidoEn: z.number().int().positive(),
  }),
  z.object({
    tipo: z.literal("atributos"),
    nodoId: z.string().uuid(),
    espacioId: z.string().uuid(),
    fw: z.string().max(32),
    recibidoEn: z.number().int().positive(),
  }),
  z.object({
    tipo: z.literal("ack"),
    nodoId: z.string().uuid(),
    espacioId: z.string().uuid(),
    /** `id` del comando al que responde el nodo. */
    comandoId: z.string().min(1).max(64),
    ok: z.boolean(),
    detalle: z.string().max(200).nullable(),
    recibidoEn: z.number().int().positive(),
  }),
]);
export type EventoNodo = z.infer<typeof eventoNodo>;

/** Nombres de trabajo en la cola `lecturas`. */
export const TRABAJO_LECTURAS = "lote";
export const TRABAJO_EVENTO = "evento";
