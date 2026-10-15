import { z } from "zod";
import { nivelApi } from "./eventos.ts";

/** Días que se pueden pedir del historial (RF-35: últimos 7 y 30 días). */
export const DIAS_HISTORIAL = [7, 30] as const;

/** Zona en la que se cuenta el día calendario del historial. */
export const ZONA_HISTORIAL = "America/Mexico_City";

/** Cuántas evaluaciones de ese día cayeron en cada nivel. */
export const conteoNiveles = z.object({
  buena: z.number().int(),
  regular: z.number().int(),
  mala: z.number().int(),
  critica: z.number().int(),
  sin_datos: z.number().int(),
});
export type ConteoNiveles = z.infer<typeof conteoNiveles>;

/** Promedios del día por parámetro (modo avanzado, RF-23). `null` si ese día no hubo dato del sensor. */
export const promediosDia = z.object({
  ph: z.number().nullable(),
  temperatura: z.number().nullable(),
  conductividad: z.number().nullable(),
  turbidez: z.number().nullable(),
  turbidez_max: z.number().nullable(),
  tds: z.number().nullable(),
  lecturas: z.number().int(),
});

export const diaHistorial = z.object({
  /** Día calendario en `ZONA_HISTORIAL`, `AAAA-MM-DD`. */
  dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Nivel predominante: el más frecuente entre las evaluaciones con dato; en empate, el peor. */
  nivel: nivelApi,
  evaluaciones: conteoNiveles,
  wqi_prom: z.number().nullable(),
  wqi_min: z.number().nullable(),
  /** `null` si ese día no hay lecturas guardadas (solo evaluaciones). */
  promedios: promediosDia.nullable(),
});
export type DiaHistorial = z.infer<typeof diaHistorial>;

export const respuestaHistorial = z.object({
  nodo_id: z.string().uuid(),
  dias: z.union([z.literal(7), z.literal(30)]),
  zona: z.literal(ZONA_HISTORIAL),
  /** De más antiguo a más reciente. Los días sin ninguna evaluación ni lectura no aparecen: el cliente los dibuja vacíos. */
  historial: z.array(diaHistorial),
});
export type RespuestaHistorial = z.infer<typeof respuestaHistorial>;
