import { z } from "zod";

/**
 * Escenarios del simulador, en JSON (el plan los pedía en YAML; se evita un parser de YAML, que sería una dependencia
 * fuera del stack). Un escenario es una lista de pasos consecutivos. Cada medición de un paso es:
 *   - un número: valor fijo;
 *   - `{ "de": a, "a": b }`: rampa lineal durante el paso;
 *   - `null`: sensor caído (el nodo publica la medición como `null`, RF-39).
 * Una medición que el paso no menciona conserva el valor estable por defecto. `desconectado: true` hace que el nodo
 * se caiga SIN despedirse durante el paso (el broker publica el Last Will) y vuelva al terminar.
 *
 *   { "nombre": "acidificación", "repetir": false,
 *     "pasos": [ { "duracionS": 300, "ph": 7.2 }, { "duracionS": 600, "ph": { "de": 7.2, "a": 5.8 } } ] }
 */

const medicion = z.union([
  z.number().finite(),
  z.object({ de: z.number().finite(), a: z.number().finite() }).strict(),
  z.null(),
]);

export const MEDICIONES = ["ph", "t", "ec", "turb", "tds"] as const;
export type Medicion = (typeof MEDICIONES)[number];

const paso = z
  .object({
    duracionS: z.number().positive(),
    ph: medicion.optional(),
    t: medicion.optional(),
    ec: medicion.optional(),
    turb: medicion.optional(),
    tds: medicion.optional(),
    desconectado: z.boolean().optional(),
  })
  .strict();

export const escenario = z
  .object({
    nombre: z.string().min(1),
    descripcion: z.string().optional(),
    /** Al terminar el último paso, vuelve al primero. Por defecto se queda en el valor estable. */
    repetir: z.boolean().default(false),
    pasos: z.array(paso).min(1),
  })
  .strict();
export type Escenario = z.infer<typeof escenario>;

export type Valores = { [K in Medicion]?: number | null };

/** Valores del agua estable cuando el paso no dice otra cosa. */
export const ESTABLE: Required<{ [K in Medicion]: number }> = {
  ph: 7.2,
  t: 22,
  ec: 450,
  turb: 0.6,
  tds: 290,
};

export function leerEscenario(json: unknown): Escenario {
  return escenario.parse(json);
}

export interface Muestra {
  valores: Valores;
  desconectado: boolean;
  /** `false` cuando el escenario ya terminó (y no repite): el nodo sigue con el agua estable. */
  activo: boolean;
}

/** Qué hace el nodo `transcurridoS` segundos después de empezar el escenario. */
export function evaluarEscenario(e: Escenario, transcurridoS: number): Muestra {
  const total = e.pasos.reduce((suma, p) => suma + p.duracionS, 0);
  let t = Math.max(0, transcurridoS);
  if (t >= total) {
    if (!e.repetir) return { valores: {}, desconectado: false, activo: false };
    t %= total;
  }
  for (const p of e.pasos) {
    if (t < p.duracionS) {
      const valores: Valores = {};
      for (const m of MEDICIONES) {
        const v = p[m];
        if (v === undefined) continue;
        valores[m] =
          v === null ? null : typeof v === "number" ? v : v.de + (v.a - v.de) * (t / p.duracionS);
      }
      return { valores, desconectado: p.desconectado === true, activo: true };
    }
    t -= p.duracionS;
  }
  return { valores: {}, desconectado: false, activo: false };
}
