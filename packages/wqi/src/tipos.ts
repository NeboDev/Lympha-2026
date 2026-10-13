/** Tipos del motor WQI. Sin dependencias ni E/S: el mismo código corre en el worker, en pruebas y en el simulador. */

export const PARAMETROS = ["ph", "temperatura", "conductividad", "turbidez", "tds"] as const;
export type Parametro = (typeof PARAMETROS)[number];

/** Del mejor al peor; `sin_datos` es el último porque es el estado menos informativo. */
export const NIVELES = ["buena", "regular", "mala", "critica", "sin_datos"] as const;
export type Nivel = (typeof NIVELES)[number];

export const CONFIANZAS = ["ok", "dudosa", "revisar"] as const;
export type Confianza = (typeof CONFIANZAS)[number];

export type Direccion = "alto" | "bajo";

/** Unidades: pH, °C, µS/cm, NTU y mg/L. `null` = el sensor no midió (RF-39). */
export type Mediciones = { [P in Parametro]: number | null };

/** Una lectura del nodo; `ts` en milisegundos Unix (hora del nodo). */
export interface Lectura extends Mediciones {
  ts: number;
}

/** Punto de una curva: [valor medido, puntaje 0–100]. Se interpola linealmente entre puntos. */
export type PuntoCurva = readonly [valor: number, puntaje: number];

export interface ConfigParametro {
  /** Peso en el promedio ponderado; los pesos de todos los parámetros suman 1. */
  peso: number;
  /** Si es `true`, un puntaje bajo en este parámetro limita el nivel general (RF-19). */
  limita: boolean;
  /** Puntos ordenados por valor creciente. Fuera de los extremos se repite el puntaje del extremo. */
  curva: readonly PuntoCurva[];
  /** Rango en el que el sensor puede medir algo real; fuera de él la lectura es una falla. */
  rangoFisico: readonly [minimo: number, maximo: number];
}

export interface ConfigPerfil {
  id: string;
  /** Versión del algoritmo y de las curvas (RNF-24). Cualquier cambio que altere un resultado la sube. */
  version: string;
  /** `provisional` mientras ningún especialista haya validado las curvas. */
  estado: "provisional" | "validado";
  /** Fuentes de las que salen las curvas, para quien las reemplace. */
  referencias: readonly string[];
  parametros: { [P in Parametro]: ConfigParametro };
  /** Puntaje mínimo de cada nivel; por debajo de `mala` el nivel es `critica`. */
  umbrales: { buena: number; regular: number; mala: number };
  /** Suma mínima de pesos con dato válido para calcular un WQI; por debajo, `sin_datos`. */
  pesoMinimoValido: number;
  ventana: {
    /** Lecturas que se recuerdan por nodo. */
    tamano: number;
    /** Lecturas sobre las que se toma la mediana de cada parámetro (descarta picos aislados). */
    medianaDe: number;
    /** Antes de tener estas lecturas el nivel es `sin_datos`. */
    minimoLecturas: number;
  };
  histeresis: {
    /** Puntos extra sobre el umbral que hay que superar para MEJORAR de nivel. */
    margen: number;
    /** Lecturas consecutivas que sostienen un cambio antes de confirmarlo. */
    confirmarNivel: { empeorar: number; mejorar: number };
    confirmarConfianza: { empeorar: number; mejorar: number };
  };
  confianza: {
    /** Lecturas idénticas seguidas que delatan un sensor congelado. */
    lecturasCongelado: number;
  };
}
