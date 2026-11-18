/**
 * Escenarios del simulador de nodo. Funciones puras del tiempo: dado el segundo `t` del escenario,
 * dicen qué mediría y reportaría el nodo (como lo haría el firmware).
 * El ruido es determinista (sin Math.random) para que las pruebas sean repetibles.
 */

export const NOMBRES_ESCENARIOS = [
  "estable",
  "acidificacion",
  "demo_limon",
  "pico",
  "sensor_desconectado",
  "nodo_detenido",
] as const;
export type NombreEscenario = (typeof NOMBRES_ESCENARIOS)[number];

/** Estado que el firmware publica en V4: 0 ok · 1 atención · 2 fuera de rango · 3 error de sensor. */
export type EstadoNodo = 0 | 1 | 2 | 3;

export type Muestra = {
  /** `false` = el nodo está detenido y no escribe nada (el `seq` no avanza). */
  escribe: boolean;
  /** pH ya filtrado (V2). */
  ph: number;
  /** pH sin filtrar (V7). */
  phCrudo: number;
  /** V5: 1 si la lectura es estable. */
  estable: boolean;
  /** V4. */
  estado: EstadoNodo;
};

export type LimitesNorma = { min: number; max: number };

const PH_BASE = 7.2;
const PH_ACIDO = 5.2; // como con limón: baja hasta zona crítica (más de 1.0 bajo 6.5)
const PH_DEMO = 5.3; // el mínimo de la demo: crítico (más de 1.0 bajo 6.5), como con limón
const PH_PICO = 8.0; // sube 0.8: sigue en rango, pero es un cambio rápido
const RIEL = 14;
const MARGEN_ATENCION = 0.3; // el mismo margen que usa el servidor (parametros.json)

/** Hash determinista en [-1, 1]. */
function ruido(t: number, semilla: number): number {
  const x = Math.sin(t * 12.9898 + semilla * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

const rampa = (t: number, t0: number, t1: number, a: number, b: number) =>
  a + ((b - a) * (t - t0)) / (t1 - t0);

type Base = (t: number) => { ph: number; sensorOk: boolean; escribe: boolean };

const ESCENARIOS: Record<NombreEscenario, { descripcion: string; duracionS: number; base: Base }> =
  {
    estable: {
      descripcion: "pH 7.2 estable, siempre en rango",
      duracionS: 300,
      base: () => ({ ph: PH_BASE, sensorOk: true, escribe: true }),
    },
    acidificacion: {
      descripcion: "baja de 7.2 a 5.2 (limón), se sostiene y se recupera (bicarbonato); ~8 min",
      duracionS: 480,
      base: (t) => {
        let ph = PH_BASE;
        if (t >= 60 && t < 180) ph = rampa(t, 60, 180, PH_BASE, PH_ACIDO);
        else if (t >= 180 && t < 300) ph = PH_ACIDO;
        else if (t >= 300 && t < 420) ph = rampa(t, 300, 420, PH_ACIDO, PH_BASE);
        return { ph, sensorOk: true, escribe: true };
      },
    },
    demo_limon: {
      descripcion:
        "para la demo: pH 7.2, baja a 5.3 en 30 s (limón), se sostiene 30 s y se recupera en 30 s; ~2 min",
      duracionS: 120,
      base: (t) => {
        let ph = PH_BASE;
        if (t >= 20 && t < 50) ph = rampa(t, 20, 50, PH_BASE, PH_DEMO);
        else if (t >= 50 && t < 80) ph = PH_DEMO;
        else if (t >= 80 && t < 110) ph = rampa(t, 80, 110, PH_DEMO, PH_BASE);
        return { ph, sensorOk: true, escribe: true };
      },
    },
    pico: {
      descripcion: "sube de 7.2 a 8.0 en 1 min y vuelve; sigue en rango pero es un cambio rápido",
      duracionS: 600,
      base: (t) => {
        let ph = PH_BASE;
        if (t >= 60 && t < 120) ph = rampa(t, 60, 120, PH_BASE, PH_PICO);
        else if (t >= 120 && t < 180) ph = rampa(t, 120, 180, PH_PICO, PH_BASE);
        return { ph, sensorOk: true, escribe: true };
      },
    },
    sensor_desconectado: {
      descripcion: "pH normal 60 s y luego la lectura se pega al riel (14.0) con estado = 3",
      duracionS: 300,
      base: (t) =>
        t < 60
          ? { ph: PH_BASE, sensorOk: true, escribe: true }
          : { ph: RIEL, sensorOk: false, escribe: true },
    },
    nodo_detenido: {
      descripcion:
        "normal 60 s, deja de escribir hasta los 240 s (seq quieto) y luego se reconecta",
      duracionS: 360,
      base: (t) => ({ ph: PH_BASE, sensorOk: true, escribe: !(t >= 60 && t < 240) }),
    },
  };

export function descripcionDe(nombre: NombreEscenario): string {
  return ESCENARIOS[nombre].descripcion;
}

/** Duración orientativa del escenario (después de eso, el último valor se mantiene). */
export function duracionDe(nombre: NombreEscenario): number {
  return ESCENARIOS[nombre].duracionS;
}

export function esEscenario(nombre: string): nombre is NombreEscenario {
  return (NOMBRES_ESCENARIOS as readonly string[]).includes(nombre);
}

/** Estado V4 como lo calcularía el firmware (sin crítico: eso lo decide el servidor). */
export function estadoNodo(ph: number, sensorOk: boolean, norma: LimitesNorma): EstadoNodo {
  if (!sensorOk) return 3;
  if (ph < norma.min || ph > norma.max) return 2;
  if (ph - norma.min <= MARGEN_ATENCION || norma.max - ph <= MARGEN_ATENCION) return 1;
  return 0;
}

const limitar = (v: number) => Math.min(14, Math.max(0, v));

/** Lo que el nodo mediría y reportaría `t` segundos después de empezar el escenario. */
export function muestra(nombre: NombreEscenario, t: number, norma: LimitesNorma): Muestra {
  const { base } = ESCENARIOS[nombre];
  const ahora = base(t);
  const antes = base(Math.max(0, t - 30));
  const ph = limitar(ahora.ph + (ahora.sensorOk ? ruido(t, 1) * 0.01 : 0));
  const phCrudo = limitar(ahora.ph + (ahora.sensorOk ? ruido(t, 2) * 0.08 : 0));
  return {
    escribe: ahora.escribe,
    ph,
    phCrudo,
    estable: ahora.sensorOk && Math.abs(ahora.ph - antes.ph) < 0.02,
    estado: estadoNodo(ahora.ph, ahora.sensorOk, norma),
  };
}
