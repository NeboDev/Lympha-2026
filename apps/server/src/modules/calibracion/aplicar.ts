import {
  aplicarCalibracion,
  type Coeficientes,
  esIdentidad,
  PARAMETROS_CALIBRABLES,
  type ParametroCalibrable,
} from "@lympha/calibracion";

export type CoeficientesNodo = ReadonlyMap<ParametroCalibrable, Coeficientes>;

/** Lo mínimo que se necesita de una lectura para corregirla; la fila real puede traer más campos. */
export interface FilaCalibrable {
  nodoId: string;
  ph: number | null;
  conductividad: number | null;
  tds: number | null;
  turbidez: number | null;
  crudo?: Record<string, number> | undefined;
}

/**
 * Corrige las lecturas con la calibración vigente de su nodo y conserva el valor sin calibrar en `crudo` (solo de
 * los parámetros que cambiaron). No muta la entrada: un lote que se reintenta parte siempre de los valores
 * originales, así que no se calibra dos veces. La temperatura no se calibra. Un parámetro sin calibración (o con
 * la identidad) pasa igual y no deja `crudo`.
 */
export function calibrarFilas<T extends FilaCalibrable>(
  filas: readonly T[],
  coeficientes: ReadonlyMap<string, CoeficientesNodo>,
): T[] {
  return filas.map((fila) => {
    const nodo = coeficientes.get(fila.nodoId);
    if (!nodo || nodo.size === 0) return fila;
    const nueva: T = { ...fila };
    const crudo: Record<string, number> = {};
    for (const parametro of PARAMETROS_CALIBRABLES) {
      const c = nodo.get(parametro);
      const valor = fila[parametro];
      if (!c || esIdentidad(c) || valor === null) continue;
      const calibrado = aplicarCalibracion(valor, c);
      if (calibrado === null || !Number.isFinite(calibrado)) continue;
      crudo[parametro] = valor;
      nueva[parametro] = calibrado as T[typeof parametro];
    }
    if (Object.keys(crudo).length > 0) nueva.crudo = crudo;
    return nueva;
  });
}
