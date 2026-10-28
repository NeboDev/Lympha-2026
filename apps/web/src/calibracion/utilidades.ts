import {
  aplicarCalibracion,
  type Coeficientes,
  type ParametroCalibrable,
  type PuntoCalibracion,
} from "@lympha/calibracion";
import type { EstadoCalibracion, LecturaApi, ResumenCalibracion } from "@lympha/contracts";

export const NOMBRES_PARAMETRO_CAL: Record<ParametroCalibrable, string> = {
  ph: "pH",
  conductividad: "Conductividad",
  tds: "Sólidos disueltos (TDS)",
  turbidez: "Turbidez",
};

export interface LecturaCruda {
  ts: string;
  valor: number;
}

/** Lo que midió el sensor SIN calibrar: el `crudo` guardado si la lectura se corrigió; si no, el propio valor. */
export function valorCrudo(lectura: LecturaApi, parametro: ParametroCalibrable): number | null {
  return lectura.crudo?.[parametro] ?? lectura[parametro];
}

/** Hora (del nodo) de la lectura más reciente, para marcar «desde aquí» al empezar a medir una solución. */
export function anclaDe(lecturas: readonly LecturaApi[]): string | null {
  let ancla: string | null = null;
  for (const l of lecturas) if (ancla === null || l.ts > ancla) ancla = l.ts;
  return ancla;
}

/**
 * Lecturas crudas de un parámetro posteriores al ancla, de la más antigua a la más reciente (la API las da al
 * revés). Se compara con la hora del propio nodo, así que un reloj del teléfono desfasado no afecta.
 */
export function lecturasCrudas(
  lecturas: readonly LecturaApi[],
  parametro: ParametroCalibrable,
  ancla: string | null,
): LecturaCruda[] {
  return lecturas
    .filter((l) => ancla === null || l.ts > ancla)
    .map((l) => ({ ts: l.ts, valor: valorCrudo(l, parametro) }))
    .filter((l): l is LecturaCruda => l.valor !== null)
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

export interface FilaVistaPrevia {
  referencia: number;
  crudo: number;
  calibrado: number;
  /** calibrado − referencia */
  error: number;
}

/** Cómo quedaría cada punto capturado con la recta nueva (el error que queda es lo que la recta no explica). */
export function vistaPrevia(
  puntos: readonly PuntoCalibracion[],
  coeficientes: Coeficientes,
): FilaVistaPrevia[] {
  return puntos.map((p) => {
    const calibrado = aplicarCalibracion(p.crudo, coeficientes) ?? p.crudo;
    return {
      referencia: p.referencia,
      crudo: p.crudo,
      calibrado,
      error: calibrado - p.referencia,
    };
  });
}

/** Fecha y hora en la zona del producto (America/Mexico_City), sin importar la del teléfono. */
export function fechaMexico(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const ETIQUETA_ESTADO_CAL: Record<EstadoCalibracion, string> = {
  sin_calibrar: "Sin calibrar",
  vigente: "Calibración al día",
  vencida: "Calibración vencida",
};

/** Número legible para pendiente, desfase y errores: 4 cifras significativas, sin notación científica. */
export function numeroCal(valor: number): string {
  if (!Number.isFinite(valor)) return "—";
  const redondeado = Number(valor.toPrecision(4));
  return redondeado.toLocaleString("es-MX", { maximumFractionDigits: 6 });
}

export const resumenVencido = (r: ResumenCalibracion | undefined): boolean =>
  r?.estado === "vencida";

export type TipoSolucion = "ph4" | "ph7" | "ph10" | "destilada" | "conductividad" | "turbidez";

/** Qué solución es, para dibujarla del color que tiene en el frasco (pH: la más cercana de 4, 7 y 10). */
export function tipoSolucion(parametro: ParametroCalibrable, referencia: number): TipoSolucion {
  if (parametro === "ph") {
    if (referencia < 5.5) return "ph4";
    return referencia > 8.5 ? "ph10" : "ph7";
  }
  if (!(referencia > 0)) return "destilada";
  return parametro === "turbidez" ? "turbidez" : "conductividad";
}
