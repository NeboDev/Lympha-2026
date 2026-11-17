import type { MuestraReporte } from "./puertos.ts";

/**
 * Estadísticas puras de un parámetro en un periodo. Cada muestra «cubre» el tiempo hasta la
 * siguiente, con tope `huecoMaxS`: si pasa más tiempo, el tramo es un hueco (no se rellena ni se
 * cuenta como dato). Así la cobertura y el % en rango no dependen de cada cuánto se sondeó.
 */

export type Limites = { min: number | null; max: number | null };

export type EstadisticaParametro = {
  n: number;
  promedio: number | null;
  minimo: number | null;
  maximo: number | null;
  /** % del tiempo con datos dentro de los límites; null si no hay límites o no hay datos. */
  pctEnRango: number | null;
  /** Segundos del periodo cubiertos por datos. */
  segundosConDatos: number;
  /** % del periodo cubierto por datos (0–100). */
  coberturaPct: number;
  huecos: number;
  huecoMayorS: number | null;
  /** Segundos con datos por estado evaluado (en_rango, atencion, …). */
  segundosPorEstado: Record<string, number>;
};

export const enRango = (valor: number, l: Limites): boolean =>
  (l.min === null || valor >= l.min) && (l.max === null || valor <= l.max);

export function estadisticasParametro(
  muestras: readonly MuestraReporte[],
  parametro: string,
  limites: Limites | null,
  desde: Date,
  hasta: Date,
  huecoMaxS: number,
): EstadisticaParametro {
  const periodoS = Math.max(0, (hasta.getTime() - desde.getTime()) / 1000);
  const validas = muestras.filter(
    (m) =>
      m.ts >= desde &&
      m.ts <= hasta &&
      typeof m.v[parametro] === "number" &&
      Number.isFinite(m.v[parametro]),
  );

  let suma = 0;
  let minimo: number | null = null;
  let maximo: number | null = null;
  let segundos = 0;
  let segundosEnRango = 0;
  let huecos = 0;
  let huecoMayorS: number | null = null;
  const segundosPorEstado: Record<string, number> = {};

  const registrarHueco = (s: number) => {
    huecos += 1;
    huecoMayorS = huecoMayorS === null ? s : Math.max(huecoMayorS, s);
  };

  // Antes de la primera muestra.
  if (validas.length === 0) {
    if (periodoS > 0) registrarHueco(periodoS);
  } else {
    const primera = validas[0] as MuestraReporte;
    const antes = (primera.ts.getTime() - desde.getTime()) / 1000;
    if (antes > huecoMaxS) registrarHueco(antes);
  }

  validas.forEach((m, i) => {
    const valor = m.v[parametro] as number;
    suma += valor;
    minimo = minimo === null ? valor : Math.min(minimo, valor);
    maximo = maximo === null ? valor : Math.max(maximo, valor);

    const siguiente = validas[i + 1]?.ts ?? hasta;
    const dt = Math.max(0, (siguiente.getTime() - m.ts.getTime()) / 1000);
    const cubre = Math.min(dt, huecoMaxS);
    if (dt > huecoMaxS) registrarHueco(dt);
    segundos += cubre;
    if (limites && enRango(valor, limites)) segundosEnRango += cubre;
    const estado = m.estados?.[parametro];
    if (estado) segundosPorEstado[estado] = (segundosPorEstado[estado] ?? 0) + cubre;
  });

  return {
    n: validas.length,
    promedio: validas.length === 0 ? null : suma / validas.length,
    minimo,
    maximo,
    pctEnRango: limites && segundos > 0 ? (segundosEnRango / segundos) * 100 : null,
    segundosConDatos: segundos,
    coberturaPct: periodoS > 0 ? Math.min(100, (segundos / periodoS) * 100) : 0,
    huecos,
    huecoMayorS,
    segundosPorEstado,
  };
}

/**
 * Serie para la gráfica: el periodo se parte en `puntos` tramos iguales y cada uno vale el promedio
 * de sus muestras, o `null` si no tuvo ninguna (un hueco: la línea se corta, no se interpola).
 */
export function serieGrafica(
  muestras: readonly MuestraReporte[],
  parametro: string,
  desde: Date,
  hasta: Date,
  puntos: number,
): (number | null)[] {
  const ancho = (hasta.getTime() - desde.getTime()) / puntos;
  const sumas = new Array<number>(puntos).fill(0);
  const cuentas = new Array<number>(puntos).fill(0);
  if (ancho <= 0) return new Array<null>(puntos).fill(null);
  for (const m of muestras) {
    const valor = m.v[parametro];
    if (typeof valor !== "number" || !Number.isFinite(valor)) continue;
    if (m.ts < desde || m.ts > hasta) continue;
    const i = Math.min(puntos - 1, Math.floor((m.ts.getTime() - desde.getTime()) / ancho));
    sumas[i] = (sumas[i] as number) + valor;
    cuentas[i] = (cuentas[i] as number) + 1;
  }
  return sumas.map((s, i) => ((cuentas[i] as number) > 0 ? s / (cuentas[i] as number) : null));
}
