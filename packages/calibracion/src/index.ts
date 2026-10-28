/**
 * Calibración lineal de sensores (puro, sin E/S): lo usan el servidor (regresión al guardar, aplicación a cada
 * lectura) y la PWA (estabilización en vivo y vista previa), así que los dos calculan exactamente lo mismo.
 *
 *   valor_calibrado = pendiente · valor_crudo + desfase
 */

export const PARAMETROS_CALIBRABLES = ["ph", "conductividad", "tds", "turbidez"] as const;
export type ParametroCalibrable = (typeof PARAMETROS_CALIBRABLES)[number];

export const esParametroCalibrable = (x: string): x is ParametroCalibrable =>
  (PARAMETROS_CALIBRABLES as readonly string[]).includes(x);

export interface Coeficientes {
  pendiente: number;
  desfase: number;
}

export const IDENTIDAD: Coeficientes = { pendiente: 1, desfase: 0 };

export interface PuntoCalibracion {
  /** Lo que midió el sensor (promedio estable, sin calibrar). */
  crudo: number;
  /** El valor real de la solución patrón. */
  referencia: number;
}

export interface ResultadoRegresion extends Coeficientes {
  /** Coeficiente de determinación (1 = todos los puntos sobre la recta). */
  r2: number;
  puntos: number;
}

export type CodigoErrorCalibracion =
  | "puntos_insuficientes"
  | "puntos_repetidos"
  | "valor_invalido"
  | "pendiente_no_positiva";

export class ErrorCalibracion extends Error {
  readonly codigo: CodigoErrorCalibracion;
  constructor(codigo: CodigoErrorCalibracion, mensaje: string) {
    super(mensaje);
    this.name = "ErrorCalibracion";
    this.codigo = codigo;
  }
}

/**
 * Mínimos cuadrados de `referencia` contra `crudo`. Con dos puntos la recta es exacta (R² = 1); con más, R²
 * dice qué tan alineados quedaron. Lanza `ErrorCalibracion` si no hay recta posible o si el sensor respondería al
 * revés (pendiente ≤ 0): eso es una sonda mal conectada o puntos mal capturados, no una calibración.
 */
export function calcularRegresion(puntos: readonly PuntoCalibracion[]): ResultadoRegresion {
  if (puntos.some((p) => !Number.isFinite(p.crudo) || !Number.isFinite(p.referencia))) {
    throw new ErrorCalibracion("valor_invalido", "Hay un valor que no es un número");
  }
  const n = puntos.length;
  if (n < 2) throw new ErrorCalibracion("puntos_insuficientes", "Se necesitan al menos 2 puntos");

  const mediaX = puntos.reduce((s, p) => s + p.crudo, 0) / n;
  const mediaY = puntos.reduce((s, p) => s + p.referencia, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of puntos) {
    const dx = p.crudo - mediaX;
    const dy = p.referencia - mediaY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) {
    throw new ErrorCalibracion(
      "puntos_repetidos",
      "El sensor midió lo mismo en todos los puntos: no se puede calcular la recta",
    );
  }
  const pendiente = sxy / sxx;
  if (pendiente <= 0) {
    throw new ErrorCalibracion(
      "pendiente_no_positiva",
      "El sensor responde al revés de lo esperado; revisa la sonda y los puntos capturados",
    );
  }
  const desfase = mediaY - pendiente * mediaX;
  // con todas las referencias iguales no hay varianza que explicar: la recta es plana y exacta
  const r2 = syy === 0 || n === 2 ? 1 : Math.min(1, (sxy * sxy) / (sxx * syy));
  return { pendiente, desfase, r2, puntos: n };
}

export type AdvertenciaCalibracion = "pendiente_atipica" | "r2_bajo";

/** Rango de pendiente que un sensor sano da (ver docs/DECISIONES_AUTOCALIBRACION.md); fuera de él se avisa, no se bloquea. */
export const PENDIENTE_TIPICA = { min: 0.5, max: 2 } as const;
export const R2_MINIMO = 0.98;

export function advertencias(r: ResultadoRegresion): AdvertenciaCalibracion[] {
  const a: AdvertenciaCalibracion[] = [];
  if (r.pendiente < PENDIENTE_TIPICA.min || r.pendiente > PENDIENTE_TIPICA.max) {
    a.push("pendiente_atipica");
  }
  if (r.puntos >= 3 && r.r2 < R2_MINIMO) a.push("r2_bajo");
  return a;
}

/** Aplica la recta a una lectura; un valor ausente sigue ausente. */
export function aplicarCalibracion(crudo: number | null, c: Coeficientes): number | null {
  if (crudo === null || !Number.isFinite(crudo)) return crudo;
  return c.pendiente * crudo + c.desfase;
}

export const esIdentidad = (c: Coeficientes): boolean => c.pendiente === 1 && c.desfase === 0;

// ---------------------------------------------------------------------------------------------
// Estabilización
// ---------------------------------------------------------------------------------------------

export interface CriterioEstabilidad {
  /** Cuántas lecturas seguidas se examinan. */
  ventana: number;
  /** Desviación estándar máxima en unidades del parámetro. */
  desviacionAbsoluta: number;
  /** Desviación estándar máxima como fracción del promedio (para escalas grandes). */
  desviacionRelativa: number;
}

/** Criterios por parámetro. La desviación permitida es la mayor entre la absoluta y la relativa al promedio. */
export const CRITERIO_ESTABILIDAD: Record<ParametroCalibrable, CriterioEstabilidad> = {
  ph: { ventana: 8, desviacionAbsoluta: 0.03, desviacionRelativa: 0 },
  conductividad: { ventana: 8, desviacionAbsoluta: 5, desviacionRelativa: 0.01 },
  tds: { ventana: 8, desviacionAbsoluta: 3, desviacionRelativa: 0.01 },
  turbidez: { ventana: 8, desviacionAbsoluta: 0.5, desviacionRelativa: 0.02 },
};

export interface EvaluacionEstabilidad {
  /** ¿Ya hay suficientes lecturas y varían menos que el umbral? */
  estable: boolean;
  /** Lecturas disponibles y necesarias, para mostrar el avance. */
  disponibles: number;
  necesarias: number;
  promedio: number | null;
  desviacion: number | null;
  umbral: number | null;
}

/**
 * Examina las últimas `ventana` lecturas crudas (la más reciente al final). Estable = ventana completa y
 * desviación estándar poblacional por debajo del umbral. El promedio de esa ventana es el valor que se captura.
 */
export function evaluarEstabilidad(
  parametro: ParametroCalibrable,
  valores: readonly number[],
  criterio: CriterioEstabilidad = CRITERIO_ESTABILIDAD[parametro],
): EvaluacionEstabilidad {
  const utiles = valores.filter((v) => Number.isFinite(v));
  const ventana = utiles.slice(-criterio.ventana);
  const base = { disponibles: ventana.length, necesarias: criterio.ventana };
  if (ventana.length === 0) {
    return { ...base, estable: false, promedio: null, desviacion: null, umbral: null };
  }
  const promedio = ventana.reduce((s, v) => s + v, 0) / ventana.length;
  const varianza = ventana.reduce((s, v) => s + (v - promedio) ** 2, 0) / ventana.length;
  const desviacion = Math.sqrt(varianza);
  const umbral = Math.max(
    criterio.desviacionAbsoluta,
    criterio.desviacionRelativa * Math.abs(promedio),
  );
  return {
    ...base,
    estable: ventana.length >= criterio.ventana && desviacion <= umbral,
    promedio,
    desviacion,
    umbral,
  };
}

// ---------------------------------------------------------------------------------------------
// Guía del asistente
// ---------------------------------------------------------------------------------------------

export interface PasoGuia {
  /** Qué solución usar. */
  titulo: string;
  /** Valor real que se propone para la solución; la persona puede corregirlo con el de su frasco. */
  referencia: number;
  /** ¿Es opcional? Solo los puntos extra de pH. */
  opcional?: boolean;
}

export interface GuiaParametro {
  unidad: string;
  /** Mínimo de puntos para poder calcular. */
  minimo: number;
  pasos: PasoGuia[];
  /** Recordatorio del procedimiento. */
  indicacion: string;
}

const ENJUAGUE = "Enjuaga la sonda con agua destilada y sécala sin frotar antes de cada punto.";

export const GUIA_CALIBRACION: Record<ParametroCalibrable, GuiaParametro> = {
  ph: {
    unidad: "",
    minimo: 2,
    indicacion: `${ENJUAGUE} Usa soluciones buffer vigentes y a temperatura ambiente.`,
    pasos: [
      { titulo: "Buffer pH 7.00", referencia: 7 },
      { titulo: "Buffer pH 4.00", referencia: 4 },
      { titulo: "Buffer pH 10.00", referencia: 10, opcional: true },
    ],
  },
  conductividad: {
    unidad: "µS/cm",
    minimo: 2,
    indicacion: `${ENJUAGUE} La solución de 1413 µS/cm debe estar a unos 25 °C.`,
    pasos: [
      { titulo: "Agua destilada (cero)", referencia: 0 },
      { titulo: "Solución patrón de 1413 µS/cm", referencia: 1413 },
    ],
  },
  tds: {
    unidad: "mg/L",
    minimo: 2,
    indicacion: `${ENJUAGUE} 1413 µS/cm equivalen a unos 706 mg/L de TDS con el factor 0.5 del nodo.`,
    pasos: [
      { titulo: "Agua destilada (cero)", referencia: 0 },
      { titulo: "Solución patrón de 1413 µS/cm (≈ 706 mg/L)", referencia: 706 },
    ],
  },
  turbidez: {
    unidad: "NTU",
    minimo: 2,
    indicacion: `${ENJUAGUE} Agita suavemente el patrón sin hacer burbujas y deja que se asienten.`,
    pasos: [
      { titulo: "Agua destilada (cero)", referencia: 0 },
      { titulo: "Patrón de turbidez conocido", referencia: 100 },
    ],
  },
};
