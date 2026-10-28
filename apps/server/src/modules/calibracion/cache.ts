import {
  type Coeficientes,
  esParametroCalibrable,
  type ParametroCalibrable,
} from "@lympha/calibracion";
import { sql } from "drizzle-orm";
import { type BdSistema, conSistema } from "../../platform/db.ts";
import type { CoeficientesNodo } from "./aplicar.ts";

/** Canal pub/sub con el id del nodo cuya calibración cambió; la API lo publica al guardar, revertir o restablecer. */
export const CANAL_INVALIDAR_CALIBRACION = "invalidar:calibracion";

export interface CacheCalibracion {
  /** Coeficientes vigentes de cada nodo pedido (de la caché o de Postgres). Un nodo sin calibración trae un mapa vacío. */
  coeficientes(nodoIds: readonly string[]): Promise<Map<string, CoeficientesNodo>>;
  invalidar(nodoId: string): void;
}

interface Entrada {
  expira: number;
  coeficientes: CoeficientesNodo;
}

/**
 * Caché en memoria del worker. Se invalida por pub/sub al cambiar una calibración y, por si un mensaje se pierde,
 * caduca sola a los `ttlMs` (5 min por defecto): el peor caso es corregir 5 minutos con la recta anterior.
 */
export function crearCacheCalibracion(
  bd: BdSistema,
  opciones: { ttlMs?: number; ahora?: () => number } = {},
): CacheCalibracion {
  const ttlMs = opciones.ttlMs ?? 5 * 60_000;
  const ahora = opciones.ahora ?? Date.now;
  const entradas = new Map<string, Entrada>();

  return {
    async coeficientes(nodoIds) {
      const salida = new Map<string, CoeficientesNodo>();
      const faltan: string[] = [];
      for (const id of new Set(nodoIds)) {
        const e = entradas.get(id);
        if (e && e.expira > ahora()) salida.set(id, e.coeficientes);
        else faltan.push(id);
      }
      if (faltan.length === 0) return salida;

      const filas = await conSistema(bd, async (tx) => {
        const r = await tx.execute<{
          nodo_id: string;
          parametro: string;
          pendiente: number;
          desfase: number;
        }>(sql`
          SELECT nodo_id, parametro, pendiente, desfase
          FROM app.calibraciones_sensor
          WHERE activa AND nodo_id IN (${sql.join(
            faltan.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`);
        return r.rows;
      });

      const porNodo = new Map<string, Map<ParametroCalibrable, Coeficientes>>(
        faltan.map((id) => [id, new Map()]),
      );
      for (const f of filas) {
        if (esParametroCalibrable(f.parametro)) {
          porNodo.get(f.nodo_id)?.set(f.parametro, { pendiente: f.pendiente, desfase: f.desfase });
        }
      }
      for (const [id, mapa] of porNodo) {
        entradas.set(id, { expira: ahora() + ttlMs, coeficientes: mapa });
        salida.set(id, mapa);
      }
      return salida;
    },
    invalidar(nodoId) {
      entradas.delete(nodoId);
    },
  };
}
