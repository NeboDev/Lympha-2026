import { CONFIANZAS, type EstadoMotor, NIVELES, PARAMETROS } from "@lympha/wqi";
import { z } from "zod";
import type { Redis } from "../../platform/valkey.ts";

/**
 * Memoria del motor por nodo en Valkey (se puede perder: `arranque.ts` la reconstruye desde Postgres).
 *   nodo:{id}:ventana     lista, últimas lecturas (una por elemento, JSON)
 *   nodo:{id}:histeresis  string JSON con los canales de nivel y confianza, y a qué espacio/versión pertenecen
 */

const TTL_S = 2 * 60 * 60;
const claveVentana = (nodoId: string) => `nodo:${nodoId}:ventana`;
const claveHisteresis = (nodoId: string) => `nodo:${nodoId}:histeresis`;

const medicion = z.number().nullable();
const lectura = z.object({
  ts: z.number(),
  ph: medicion,
  temperatura: medicion,
  conductividad: medicion,
  turbidez: medicion,
  tds: medicion,
});

const canal = <T extends z.ZodTypeAny>(valor: T) =>
  z.object({
    actual: valor.nullable(),
    pendiente: z
      .object({ sentido: z.enum(["peor", "mejor"]), cuenta: z.number().int(), valor })
      .nullable(),
  });

const parametro = z.enum(PARAMETROS);
const histeresis = z.object({
  /** Una versión distinta del algoritmo o un espacio distinto invalidan la memoria. */
  version: z.string(),
  espacioId: z.string().uuid(),
  ultimoTs: z.number().nullable(),
  nivel: canal(z.enum(NIVELES)),
  confianza: canal(z.enum(CONFIANZAS)),
  limitante: z.object({ parametro, direccion: z.enum(["alto", "bajo"]) }).nullable(),
});

export interface MemoriaNodo {
  espacioId: string;
  version: string;
  motor: EstadoMotor;
}

/** Lee la memoria del nodo; `null` si falta, está incompleta o es de otra versión/espacio. */
export async function leerMemoria(
  valkey: Redis,
  nodoId: string,
  espacioId: string,
  version: string,
): Promise<MemoriaNodo | null> {
  const r = await valkey
    .multi()
    .lrange(claveVentana(nodoId), 0, -1)
    .get(claveHisteresis(nodoId))
    .exec();
  const ventanaCruda = r?.[0]?.[1] as string[] | undefined;
  const histeresisCruda = r?.[1]?.[1] as string | null | undefined;
  if (!ventanaCruda || ventanaCruda.length === 0 || !histeresisCruda) return null;
  try {
    const h = histeresis.parse(JSON.parse(histeresisCruda));
    if (h.version !== version || h.espacioId !== espacioId) return null;
    const ventana = ventanaCruda.map((x) => lectura.parse(JSON.parse(x)));
    return {
      espacioId,
      version,
      motor: {
        ventana,
        ultimoTs: h.ultimoTs,
        nivel: h.nivel,
        confianza: h.confianza,
        limitante: h.limitante,
      },
    };
  } catch {
    return null;
  }
}

export async function guardarMemoria(valkey: Redis, nodoId: string, m: MemoriaNodo): Promise<void> {
  const { motor } = m;
  const p = valkey.multi().del(claveVentana(nodoId));
  if (motor.ventana.length > 0) {
    p.rpush(claveVentana(nodoId), ...motor.ventana.map((l) => JSON.stringify(l)));
    p.expire(claveVentana(nodoId), TTL_S);
  }
  p.set(
    claveHisteresis(nodoId),
    JSON.stringify({
      version: m.version,
      espacioId: m.espacioId,
      ultimoTs: motor.ultimoTs,
      nivel: motor.nivel,
      confianza: motor.confianza,
      limitante: motor.limitante,
    }),
    "EX",
    TTL_S,
  );
  const r = await p.exec();
  const fallo = r?.find(([e]) => e);
  if (fallo?.[0]) throw fallo[0];
}
