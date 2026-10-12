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
