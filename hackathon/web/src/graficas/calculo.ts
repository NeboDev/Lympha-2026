import type { Serie } from "../api/tipos.ts";
import { horaMx, valorLegible } from "../util/formato.ts";

/**
 * Cálculo puro de la gráfica SVG: escalas, tramos (la línea se corta en los huecos, no se interpola) y la
 * descripción en texto para quien no ve la imagen. Sin librería de gráficas, a mano.
 */

export type Limites = { min: number | null; max: number | null };

export type PuntoGrafica = { t: number; prom: number; min: number; max: number };

/** Los puntos de un parámetro, en milisegundos, listos para dibujar. */
export function puntosDe(serie: Serie, parametro: string): PuntoGrafica[] {
  return serie.puntos.flatMap((p) => {
    const v = p.v[parametro];
    return v ? [{ t: p.ts.getTime(), prom: v.prom, min: v.min, max: v.max }] : [];
  });
}

/** Rango vertical: contiene los datos y la franja de la norma, con aire arriba y abajo. */
export function dominioY(puntos: readonly PuntoGrafica[], norma: Limites | null): [number, number] {
  const valores: number[] = [];
  for (const p of puntos) valores.push(p.min, p.max);
  if (norma?.min != null) valores.push(norma.min);
  if (norma?.max != null) valores.push(norma.max);
  if (valores.length === 0) return [0, 14];
  let lo = Math.min(...valores);
  let hi = Math.max(...valores);
  const aire = Math.max((hi - lo) * 0.12, 0.25);
  lo -= aire;
  hi += aire;
  return [lo, hi];
}

/** Marcas «redondas» del eje Y (≈ 4–6 marcas). */
export function marcasY(lo: number, hi: number): number[] {
  const paso = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100].find((p) => (hi - lo) / p <= 6) ?? 100;
  const marcas: number[] = [];
  for (let v = Math.ceil(lo / paso) * paso; v <= hi + 1e-9; v += paso)
    marcas.push(Number(v.toFixed(6)));
  return marcas;
}

export const escala =
  (d0: number, d1: number, r0: number, r1: number) =>
  (v: number): number =>
    d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);

/**
 * Parte los puntos en tramos continuos: si entre dos puntos pasa más de `factor` veces el paso de la serie,
 * hay un hueco y la línea se corta (no se inventa lo que el nodo no envió).
 */
export function tramos(
  puntos: readonly PuntoGrafica[],
  pasoMs: number,
  factor = 2.5,
): PuntoGrafica[][] {
  const salida: PuntoGrafica[][] = [];
  let actual: PuntoGrafica[] = [];
  for (const p of puntos) {
    const ant = actual.at(-1);
    if (ant && p.t - ant.t > pasoMs * factor) {
      salida.push(actual);
      actual = [];
    }
    actual.push(p);
  }
  if (actual.length > 0) salida.push(actual);
  return salida;
}

/** Texto para lectores de pantalla: «pH entre 6.9 y 7.3 en las últimas 24 h». */
export function descripcionGrafica(
  nombre: string,
  decimales: number,
  puntos: readonly PuntoGrafica[],
  desde: Date,
  hasta: Date,
): string {
  if (puntos.length === 0) return `Sin datos de ${nombre} en este periodo.`;
  const lo = Math.min(...puntos.map((p) => p.min));
  const hi = Math.max(...puntos.map((p) => p.max));
  const horas = Math.round((hasta.getTime() - desde.getTime()) / 3_600_000);
  const periodo =
    horas >= 48 ? `los últimos ${Math.round(horas / 24)} días` : `las últimas ${horas} h`;
  return `${nombre} entre ${valorLegible(lo, decimales)} y ${valorLegible(hi, decimales)} en ${periodo}.`;
}

export type DatosLinea = {
  /** Instantes (uno por punto y uno extra en cada hueco). */
  t: Date[];
  prom: (number | null)[];
  min: (number | null)[];
  max: (number | null)[];
};

/**
 * Los puntos como arreglos paralelos para una gráfica de líneas. En cada hueco (el nodo no envió datos) se mete un
 * punto vacío (`null`) para que la línea se corte y no se invente lo que no se midió.
 */
export function datosParaLinea(puntos: readonly PuntoGrafica[], pasoMs: number): DatosLinea {
  const salida: DatosLinea = { t: [], prom: [], min: [], max: [] };
  tramos(puntos, pasoMs).forEach((tramo, i, todos) => {
    for (const p of tramo) {
      salida.t.push(new Date(p.t));
      salida.prom.push(p.prom);
      salida.min.push(p.min);
      salida.max.push(p.max);
    }
    const ultimo = tramo.at(-1);
    if (ultimo && i < todos.length - 1) {
      salida.t.push(new Date(ultimo.t + pasoMs));
      salida.prom.push(null);
      salida.min.push(null);
      salida.max.push(null);
    }
  });
  return salida;
}

/** Etiquetas del eje X: inicio, mitad y fin (hora si el periodo es corto; si no, solo el día). */
export function marcasX(desde: Date, hasta: Date): { t: number; texto: string }[] {
  const corto = hasta.getTime() - desde.getTime() <= 2 * 86_400_000;
  const medio = (desde.getTime() + hasta.getTime()) / 2;
  const fmt = (t: number) =>
    corto
      ? horaMx(new Date(t))
      : new Intl.DateTimeFormat("es-MX", {
          timeZone: "America/Mexico_City",
          day: "numeric",
          month: "short",
        }).format(new Date(t));
  return [desde.getTime(), medio, hasta.getTime()].map((t) => ({ t, texto: fmt(t) }));
}
