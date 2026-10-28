import { z } from "zod";

/**
 * Calibración lineal por nodo y parámetro (`valor_calibrado = pendiente · crudo + desfase`). El servidor recalcula
 * la recta a partir de los puntos: el cliente nunca manda coeficientes. `offset` se llama `desfase` (palabra
 * reservada de SQL) en la base y en la API.
 */

export const parametroCalibrable = z.enum(["ph", "conductividad", "tds", "turbidez"]);
export type ParametroCalibrableApi = z.infer<typeof parametroCalibrable>;

const uuid = z.string().uuid();
const numero = z.number().finite();

export const puntoCalibracion = z.object({ crudo: numero, referencia: numero }).strict();
export type PuntoCalibracionApi = z.infer<typeof puntoCalibracion>;

export const MAX_PUNTOS_CALIBRACION = 10;

export const origenCalibracion = z.enum(["guiada", "identidad"]);

export const calibracionApi = z.object({
  id: uuid,
  nodo_id: uuid,
  espacio_id: uuid,
  parametro: parametroCalibrable,
  pendiente: numero,
  desfase: numero,
  r2: numero.nullable(),
  puntos: z.array(puntoCalibracion),
  origen: origenCalibracion,
  activa: z.boolean(),
  creado_por: uuid.nullable(),
  creado_en: z.string().datetime(),
  advertencias: z.array(z.enum(["pendiente_atipica", "r2_bajo"])).default([]),
});
export type CalibracionApi = z.infer<typeof calibracionApi>;

export const crearCalibracionBody = z
  .object({
    nodo_id: uuid,
    parametro: parametroCalibrable,
    puntos: z.array(puntoCalibracion).min(2).max(MAX_PUNTOS_CALIBRACION),
  })
  .strict();

export const restablecerCalibracionBody = z
  .object({ nodo_id: uuid, parametro: parametroCalibrable })
  .strict();

export const listaCalibracionesQuery = z.object({
  nodo_id: uuid,
  parametro: parametroCalibrable.optional(),
  limite: z.coerce.number().int().min(1).max(100).default(50),
});

export const listaCalibracionesRespuesta = z.object({ calibraciones: z.array(calibracionApi) });

/** Estado de calibración de un nodo para las listas: `vencida` pasado el plazo del perfil (por defecto 90 días). */
export const estadoCalibracion = z.enum(["sin_calibrar", "vigente", "vencida"]);
export type EstadoCalibracion = z.infer<typeof estadoCalibracion>;

export const resumenCalibracion = z.object({
  /** La calibración guiada vigente más reciente (hora UTC; la PWA la muestra en America/Mexico_City). */
  ultima_en: z.string().datetime().nullable(),
  estado: estadoCalibracion,
});
export type ResumenCalibracion = z.infer<typeof resumenCalibracion>;

/** Cambio de calibración de un nodo (`event: calibracion`, canal `espacio:{id}`). Se reconoce por `calibracion_id`. */
export const eventoCalibracion = z.object({
  calibracion_id: uuid,
  nodo_id: uuid,
  espacio_id: uuid,
  parametro: parametroCalibrable,
  cambio: z.enum(["registrada", "revertida", "restablecida"]),
  pendiente: numero,
  desfase: numero,
  actualizado_en: z.string().datetime(),
});
export type EventoCalibracion = z.infer<typeof eventoCalibracion>;
