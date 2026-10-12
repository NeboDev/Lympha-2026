import { z } from "zod";

const componente = z.enum(["ok", "error"]);

export const respuestaHealth = z.object({
  estado: z.enum(["ok", "degradado"]),
  version: z.string(),
  componentes: z.object({
    postgres: componente,
    valkey: componente,
    mqtt: componente,
  }),
});
export type RespuestaHealth = z.infer<typeof respuestaHealth>;

export const lecturaApi = z.object({
  nodo_id: z.string().uuid(),
  ts: z.string().datetime(),
  seq: z.number().int(),
  ph: z.number().nullable(),
  temperatura: z.number().nullable(),
  conductividad: z.number().nullable(),
  turbidez: z.number().nullable(),
  tds: z.number().nullable(),
});
export type LecturaApi = z.infer<typeof lecturaApi>;

export const respuestaError = z.object({
  codigo: z.string(),
  mensaje: z.string(),
});
export type RespuestaError = z.infer<typeof respuestaError>;
