import { z } from "zod";

/**
 * Nombre del producto y afirmaciones que los avisos solo pueden hacer si son ciertas.
 * Se cambia en `server/config/marca.json`, no en el código.
 */
const marcaEsquema = z
  .object({
    nombre: z.string().min(1),
    nombre_bot: z.string().min(1),
    /** `true` cuando el firmware ya tiene (y se probó) la alarma local: entonces el aviso de «sin conexión» lo dice. */
    alarma_local_en_avisos: z.boolean(),
    /** `true` cuando el control del actuador existe: entonces el aviso crítico dice «detuvimos la dosificación». */
    dosificacion_automatica: z.boolean(),
  })
  .strict();

export type Marca = z.infer<typeof marcaEsquema>;

export function parsearMarca(json: unknown): Marca {
  const r = marcaEsquema.safeParse(json);
  if (!r.success) {
    const problemas = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`marca.json inválido: ${problemas.join("; ")}`);
  }
  return r.data;
}
