/** Un punto de una serie; `y` nulo es un hueco (sensor sin dato), no un cero. */
export interface Punto {
  x: number;
  y: number | null;
}

export interface Dimensiones {
  ancho: number;
  alto: number;
  margen: { arriba: number; derecha: number; abajo: number; izquierda: number };
}

export interface Escala {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface GraficaCalculada {
  escala: Escala;
  /** Un trazo por tramo continuo (los huecos cortan la línea en vez de unir puntos que no se midieron). */
  trazos: string[];
  /** Puntos aislados (un tramo de un solo dato no se vería como línea). */
  aislados: { cx: number; cy: number }[];
  ticksY: { valor: number; y: number }[];
  ticksX: { valor: number; x: number }[];
  /** Mínimo, máximo y último valor con dato; para el resumen de texto. */
  resumen: { minimo: number; maximo: number; ultimo: number; n: number } | null;
}

/** Escala «agradable»: ~5 % de aire y nunca un rango de cero (una serie constante no se aplasta ni divide entre 0). */
export function escalaY(valores: number[]): { yMin: number; yMax: number } {
  if (valores.length === 0) return { yMin: 0, yMax: 1 };
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const holgura = min === max ? Math.max(Math.abs(min) * 0.05, 0.5) : (max - min) * 0.08;
  // Los parámetros del agua no son negativos: si los datos tampoco lo son, el eje no baja de cero (sería un
  // «-0.5 NTU» de turbidez sin sentido).
  const yMin = min >= 0 ? Math.max(0, min - holgura) : min - holgura;
  return { yMin, yMax: max + holgura };
}

/** `n` valores equiespaciados entre `desde` y `hasta` (ambos incluidos). */
export function ticks(desde: number, hasta: number, n: number): number[] {
  if (n < 2) return [desde];
  return Array.from({ length: n }, (_, i) => desde + ((hasta - desde) * i) / (n - 1));
}

/**
 * Convierte una serie en trazos SVG. Los puntos se ordenan por `x`; los huecos (`y` nulo o no finito) cortan el
 * trazo. Con ancho de rango cero en `x`, el punto único se centra.
 */
export function calcularGrafica(puntos: Punto[], d: Dimensiones): GraficaCalculada {
  const validos = puntos
    .filter((p): p is { x: number; y: number } => p.y !== null && Number.isFinite(p.y))
    .sort((a, b) => a.x - b.x);
  const todosX = puntos.map((p) => p.x);
  const xMin = todosX.length ? Math.min(...todosX) : 0;
  const xMax = todosX.length ? Math.max(...todosX) : 1;
  const { yMin, yMax } = escalaY(validos.map((p) => p.y));

  const interior = {
    ancho: d.ancho - d.margen.izquierda - d.margen.derecha,
    alto: d.alto - d.margen.arriba - d.margen.abajo,
  };
  const px = (x: number) =>
    d.margen.izquierda +
    (xMax === xMin ? interior.ancho / 2 : ((x - xMin) / (xMax - xMin)) * interior.ancho);
  const py = (y: number) => d.margen.arriba + (1 - (y - yMin) / (yMax - yMin)) * interior.alto;
  const redondear = (n: number) => Math.round(n * 10) / 10;

  const trazos: string[] = [];
  const aislados: { cx: number; cy: number }[] = [];
  let tramo: { x: number; y: number }[] = [];
  const cerrar = () => {
    if (tramo.length === 1 && tramo[0]) {
      aislados.push({ cx: redondear(px(tramo[0].x)), cy: redondear(py(tramo[0].y)) });
    } else if (tramo.length > 1) {
      trazos.push(
        tramo
          .map((p, i) => `${i === 0 ? "M" : "L"}${redondear(px(p.x))} ${redondear(py(p.y))}`)
          .join(" "),
      );
    }
    tramo = [];
  };
  // se recorre la serie completa (no solo los válidos) para que un hueco corte el trazo
  const ordenados = [...puntos].sort((a, b) => a.x - b.x);
  for (const p of ordenados) {
    if (p.y === null || !Number.isFinite(p.y)) cerrar();
    else tramo.push({ x: p.x, y: p.y });
  }
  cerrar();

  const ultimo = validos.at(-1);
  return {
    escala: { xMin, xMax, yMin, yMax },
    trazos,
    aislados,
    ticksY: ticks(yMin, yMax, 4).map((valor) => ({ valor, y: redondear(py(valor)) })),
    ticksX: ticks(xMin, xMax, 3).map((valor) => ({ valor, x: redondear(px(valor)) })),
    resumen: ultimo
      ? {
          minimo: Math.min(...validos.map((p) => p.y)),
          maximo: Math.max(...validos.map((p) => p.y)),
          ultimo: ultimo.y,
          n: validos.length,
        }
      : null,
  };
}
