/**
 * Olas (blobs orgánicos 2D) del fondo del acceso: la geometría y el dibujo, sin React. Canvas 2D a mano, sin librerías
 * de partículas ni 3D. Cada ola es un círculo de radio ondulante con un degradado radial que se desvanece.
 */

export type ModoFondo = "animado" | "estatico";

type Consulta = (media: string) => { matches: boolean };

/**
 * Animado solo con puntero fino y sin pedir menos movimiento. En táctil (sin hover o puntero grueso) o con
 * `prefers-reduced-motion`, el fondo se dibuja una vez: sin `requestAnimationFrame` ni escucha del puntero.
 */
export function elegirModo(consulta: Consulta): ModoFondo {
  const tactil = consulta("(hover: none), (pointer: coarse)").matches;
  const quieto = consulta("(prefers-reduced-motion: reduce)").matches;
  return tactil || quieto ? "estatico" : "animado";
}

interface Ola {
  /** Posición de reposo, en fracción del lienzo. */
  x: number;
  y: number;
  /** Radio, en fracción del lado menor. */
  r: number;
  /** Cuánto de la distancia al cursor se acerca (0 = no lo sigue). */
  atraccion: number;
  /** Velocidad con que alcanza su objetivo (1/s): las lentas dejan estela. */
  rapidez: number;
  fase: number;
  /** Color RGB por tema: [claro, oscuro]. */
  color: [string, string];
  alfa: number;
}

// Paleta del proyecto: turquesa del logo, arena y tinta. Las alfas son bajas: es un fondo, no un protagonista.
const TURQUESA = "95,196,184";
const ARENA = "165,159,151";
const TINTA_CLARA = "0,0,0";
const TINTA_OSCURA = "253,252,252";

export const OLAS: readonly Ola[] = [
  {
    x: 0.2,
    y: 0.25,
    r: 0.42,
    atraccion: 0.35,
    rapidez: 1.6,
    fase: 0.4,
    color: [TURQUESA, TURQUESA],
    alfa: 0.3,
  },
  {
    x: 0.8,
    y: 0.3,
    r: 0.36,
    atraccion: 0.22,
    rapidez: 1.1,
    fase: 2.1,
    color: [ARENA, ARENA],
    alfa: 0.34,
  },
  {
    x: 0.7,
    y: 0.8,
    r: 0.46,
    atraccion: 0.4,
    rapidez: 0.8,
    fase: 4.0,
    color: [TURQUESA, TURQUESA],
    alfa: 0.2,
  },
  {
    x: 0.15,
    y: 0.8,
    r: 0.32,
    atraccion: 0.18,
    rapidez: 1.3,
    fase: 5.2,
    color: [TINTA_CLARA, TINTA_OSCURA],
    alfa: 0.08,
  },
];

const PUNTOS = 48;

/** Traza el contorno de una ola: un círculo cuyo radio ondula con dos senos (3 y 5 lóbulos) que derivan con `t`. */
function trazar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radio: number,
  t: number,
  fase: number,
) {
  const punto = (i: number): [number, number] => {
    const a = (i / PUNTOS) * Math.PI * 2;
    const r =
      radio *
      (1 +
        0.13 * Math.sin(3 * a + t * 0.6 + fase) +
        0.08 * Math.sin(5 * a - t * 0.45 + fase * 1.7));
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const [x0, y0] = punto(0);
  const [x1, y1] = punto(1);
  ctx.beginPath();
  ctx.moveTo((x0 + x1) / 2, (y0 + y1) / 2);
  // curvas cuadráticas entre puntos medios: el contorno sale liso, sin picos
  for (let i = 1; i <= PUNTOS; i++) {
    const [px, py] = punto(i % PUNTOS);
    const [qx, qy] = punto((i + 1) % PUNTOS);
    ctx.quadraticCurveTo(px, py, (px + qx) / 2, (py + qy) / 2);
  }
  ctx.closePath();
}

export interface Estado {
  /** Posición actual de cada ola, en píxeles. */
  pos: { x: number; y: number }[];
}

/** Posiciones de reposo para un lienzo de `ancho`×`alto` (también las del modo estático). */
export const posicionesDeReposo = (ancho: number, alto: number): Estado => ({
  pos: OLAS.map((o) => ({ x: o.x * ancho, y: o.y * alto })),
});

/** Acerca cada ola a su objetivo (reposo + atracción hacia el cursor) con suavizado independiente del cuadro. */
export function avanzar(
  estado: Estado,
  ancho: number,
  alto: number,
  cursor: { x: number; y: number },
  dt: number,
) {
  OLAS.forEach((o, i) => {
    const p = estado.pos[i];
    if (!p) return;
    const rx = o.x * ancho;
    const ry = o.y * alto;
    const objetivoX = rx + (cursor.x - rx) * o.atraccion;
    const objetivoY = ry + (cursor.y - ry) * o.atraccion;
    const k = 1 - Math.exp(-dt * o.rapidez);
    p.x += (objetivoX - p.x) * k;
    p.y += (objetivoY - p.y) * k;
  });
}

/** Dibuja todas las olas. `t` en segundos (el modo estático usa un `t` fijo). */
export function dibujar(
  ctx: CanvasRenderingContext2D,
  ancho: number,
  alto: number,
  estado: Estado,
  t: number,
  oscuro: boolean,
) {
  ctx.clearRect(0, 0, ancho, alto);
  const lado = Math.min(ancho, alto);
  OLAS.forEach((o, i) => {
    const p = estado.pos[i];
    if (!p) return;
    const radio = o.r * lado * 1.15;
    const rgb = o.color[oscuro ? 1 : 0];
    const g = ctx.createRadialGradient(p.x, p.y, radio * 0.05, p.x, p.y, radio * 1.2);
    g.addColorStop(0, `rgba(${rgb},${o.alfa})`);
    g.addColorStop(0.6, `rgba(${rgb},${o.alfa * 0.55})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    trazar(ctx, p.x, p.y, radio, t, o.fase);
    ctx.fill();
  });
}
