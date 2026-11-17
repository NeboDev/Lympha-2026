import { z } from "zod";

const reglasEsquema = z
  .object({
    /** Distancia al límite (dentro del rango) a partir de la cual el estado es «atención». */
    atencion_margen: z.number().nonnegative(),
    cambio_rapido: z
      .object({ delta: z.number().positive(), ventana_min: z.number().positive() })
      .strict(),
    /** Distancia fuera del rango a partir de la cual el estado es «crítico». */
    critico_margen: z.number().positive(),
    histeresis: z.number().nonnegative(),
    lecturas_para_entrar: z.number().int().positive(),
    estable_desv_max: z.number().nonnegative(),
    sensor_pendiente_min_pct: z.number().positive(),
    lecturas_estable: z.number().int().positive(),
    fisico_min: z.number(),
    fisico_max: z.number(),
    riel_margen: z.number().nonnegative(),
    lecturas_riel: z.number().int().positive(),
    /** Lecturas idénticas seguidas que delatan un sensor pegado. 0 = regla apagada. */
    lecturas_pegadas: z.number().int().nonnegative(),
  })
  .strict();

const normaEsquema = z
  .object({
    fuente: z.string(),
    min: z.number().nullable(),
    max: z.number().nullable(),
    estado: z.string().optional(),
  })
  .strict();

const parametroEsquema = z
  .object({
    nombre: z.string(),
    /** Género para los textos («el pH», «la turbidez»). Por defecto «el». */
    articulo: z.enum(["el", "la"]).optional(),
    unidad: z.string(),
    decimales: z.number().int().nonnegative(),
    norma: normaEsquema.nullable(),
    medible: z.boolean(),
    blynk: z.object({ pin: z.string(), crudo: z.string().optional() }).strict().nullable(),
    reglas: reglasEsquema.optional(),
    /** Efectividad del cloro según el pH (docs/cloracion-ph.md). Solo para parámetros que la afectan. */
    cloro: z
      .object({
        /** Temperatura que se supone cuando el nodo no la mide. */
        temp_defecto_c: z.number(),
        /** Por debajo de este % de HOCl, los avisos de pH alto lo mencionan. */
        aviso_bajo_pct: z.number().min(0).max(100),
      })
      .strict()
      .optional(),
    criterio: z.string().optional(),
    nota: z.string().optional(),
  })
  .strict();

const catalogoEsquema = z
  .object({
    version: z.string(),
    nota: z.string(),
    parametros: z.record(parametroEsquema),
  })
  .strict();

export type ReglasParametro = z.infer<typeof reglasEsquema>;
export type NormaParametro = z.infer<typeof normaEsquema>;
export type ParametroCatalogo = z.infer<typeof parametroEsquema>;
export type Catalogo = z.infer<typeof catalogoEsquema>;

/** Valida el contenido de `parametros.json`. Rechaza claves desconocidas. */
export function parsearCatalogo(json: unknown): Catalogo {
  const r = catalogoEsquema.safeParse(json);
  if (!r.success) {
    const problemas = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`parametros.json inválido: ${problemas.join("; ")}`);
  }
  return r.data;
}

/** Parámetro del catálogo; error tipado si no existe. */
export function parametroDe(catalogo: Catalogo, id: string): ParametroCatalogo {
  const p = catalogo.parametros[id];
  if (!p) throw new Error(`Parámetro desconocido en el catálogo: ${id}`);
  return p;
}
