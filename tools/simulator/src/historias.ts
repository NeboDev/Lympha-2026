import type { Telemetria } from "@lympha/contracts";
import type { Confianza, Mediciones, Nivel, Parametro } from "@lympha/wqi";

/**
 * Historias del simulador (escenarios de nivel esperado): historias de agua de una cisterna, con ruido de sensor real, y lo que el
 * servidor debe mostrar al final (criterio de salida de H2: cada escenario produce el nivel esperado
 * sin parpadeo). Son código y no YAML a propósito: así no se agrega un parser fuera del stack.
 *
 * `esperado.transiciones` es la secuencia COMPLETA de niveles que vería el usuario, sin repetidos:
 * `["buena", "regular"]` significa un solo cambio y ningún regreso. Cualquier vaivén lo rompe.
 */

export interface Historia {
  nombre: string;
  descripcion: string;
  /** Lecturas que publica el nodo (una por minuto en el producto). */
  lecturas: number;
  /** Valor alrededor del que oscila cada parámetro en la lectura `i`; lo no indicado es agua ideal. */
  centros(i: number): Partial<Mediciones>;
  /** Valores exactos (sin ruido) para simular un sensor congelado o una lectura aberrante aislada. */
  exactos?(i: number): Partial<Mediciones>;
  esperado: {
    transiciones: Nivel[];
    confianzaFinal: Confianza;
    /** Parámetro culpable al final, si el nivel final no es bueno. */
    parametroFinal?: Parametro | null;
  };
}

const BASE: Mediciones = {
  ph: 7.2,
  temperatura: 22,
  conductividad: 450,
  turbidez: 0.6,
  tds: 290,
};
// Mitad del ancho del ruido uniforme de cada sensor, y los decimales con que reporta.
const RUIDO: Mediciones = { ph: 0.05, temperatura: 0.3, conductividad: 8, turbidez: 0.15, tds: 5 };
const DECIMALES: Mediciones = { ph: 2, temperatura: 1, conductividad: 0, turbidez: 2, tds: 0 };
const PARAMETROS = Object.keys(BASE) as Parametro[];

const nulas: Mediciones = {
  ph: null,
  temperatura: null,
  conductividad: null,
  turbidez: null,
  tds: null,
};

/** Rampa lineal de `desde` a `hasta` entre las lecturas `i0` e `i1`; fuera de ese tramo, queda en los extremos. */
const rampa = (i: number, i0: number, i1: number, desde: number, hasta: number): number =>
  i <= i0 ? desde : i >= i1 ? hasta : desde + ((hasta - desde) * (i - i0)) / (i1 - i0);

export const HISTORIAS: readonly Historia[] = [
  {
    nombre: "estable",
    descripcion: "Agua normal todo el tiempo: el semáforo se queda en verde.",
    lecturas: 40,
    centros: () => ({}),
    esperado: { transiciones: ["buena"], confianzaFinal: "ok", parametroFinal: null },
  },
  {
    nombre: "turbidez_sube",
    descripcion:
      "La turbidez sube poco a poco de 0.6 a 12 NTU: pasa por regular y mala hasta crítica.",
    lecturas: 70,
    centros: (i) => ({ turbidez: rampa(i, 20, 40, 0.6, 12) }),
    esperado: {
      transiciones: ["buena", "regular", "mala", "critica"],
      confianzaFinal: "ok",
      parametroFinal: "turbidez",
    },
  },
  {
    nombre: "ph_alcalino_salto",
    descripcion:
      "El pH salta de golpe a 9.3 (p. ej. cal en la cisterna): crítica aunque lo demás esté bien.",
    lecturas: 40,
    centros: (i) => (i >= 15 ? { ph: 9.3 } : {}),
    esperado: { transiciones: ["buena", "critica"], confianzaFinal: "ok", parametroFinal: "ph" },
  },
  {
    nombre: "ph_acido_gradual",
    descripcion: "El pH baja de 7.2 a 5.6 en 20 lecturas.",
    lecturas: 60,
    centros: (i) => ({ ph: rampa(i, 15, 35, 7.2, 5.6) }),
    esperado: {
      transiciones: ["buena", "regular", "mala", "critica"],
      confianzaFinal: "ok",
      parametroFinal: "ph",
    },
  },
  {
    nombre: "sales_altas",
    descripcion:
      "Los sólidos disueltos y la conductividad suben juntos (agua nueva con muchas sales).",
    lecturas: 60,
    centros: (i) => ({
      tds: rampa(i, 15, 45, 290, 1400),
      conductividad: rampa(i, 15, 45, 450, 2150),
    }),
    esperado: {
      transiciones: ["buena", "regular", "mala"],
      confianzaFinal: "ok",
      parametroFinal: "conductividad",
    },
  },
  {
    nombre: "pico_aislado",
    descripcion:
      "Tres lecturas aberrantes sueltas (turbidez, pH y TDS): no deben mover el semáforo.",
    lecturas: 50,
    centros: () => ({}),
    exactos: (i) =>
      i === 20
        ? { turbidez: 50, ph: 2 }
        : i === 30
          ? { tds: 5000 }
          : i === 40
            ? { turbidez: 30 }
            : {},
    esperado: { transiciones: ["buena"], confianzaFinal: "ok", parametroFinal: null },
  },
  {
    nombre: "umbral_ruidoso",
    descripcion:
      "La turbidez ronda el límite de la NOM-127 (4 NTU) con ruido: cambia una vez y no oscila.",
    lecturas: 120,
    centros: (i) => (i >= 10 ? { turbidez: 4 } : {}),
    esperado: {
      transiciones: ["buena", "regular"],
      confianzaFinal: "ok",
      parametroFinal: "turbidez",
    },
  },
  {
    nombre: "recuperacion",
    descripcion:
      "La turbidez sube a 9 NTU y 30 lecturas después vuelve a lo normal: mala y de regreso a buena.",
    lecturas: 100,
    centros: (i) => (i >= 15 && i < 45 ? { turbidez: 9 } : {}),
    esperado: {
      transiciones: ["buena", "mala", "buena"],
      confianzaFinal: "ok",
      parametroFinal: null,
    },
  },
  {
    nombre: "sensor_congelado",
    descripcion: "El sensor de pH se queda marcando exactamente 7.2: hay que revisarlo.",
    lecturas: 45,
    centros: () => ({}),
    exactos: (i) => (i >= 15 ? { ph: 7.2 } : {}),
    esperado: {
      transiciones: ["buena", "sin_datos"],
      confianzaFinal: "revisar",
      parametroFinal: "ph",
    },
  },
  {
    nombre: "sensor_fuera_de_rango",
    descripcion: "El sensor de pH da 15.3, un valor que no existe: hay que revisarlo.",
    lecturas: 40,
    centros: (i) => (i >= 15 ? { ph: 15.3 } : {}),
    esperado: {
      transiciones: ["buena", "sin_datos"],
      confianzaFinal: "revisar",
      parametroFinal: "ph",
    },
  },
  {
    nombre: "turbidez_sin_senal",
    descripcion:
      "El sensor de turbidez deja de enviar dato: el resto se evalúa, la confianza baja a dudosa.",
    lecturas: 40,
    centros: (i) => (i >= 15 ? { turbidez: null } : {}),
    esperado: { transiciones: ["buena"], confianzaFinal: "dudosa", parametroFinal: null },
  },
  {
    nombre: "sin_senal",
    descripcion: "El nodo envía puras mediciones vacías: sin datos.",
    lecturas: 40,
    centros: (i) => (i >= 15 ? nulas : {}),
    esperado: {
      transiciones: ["buena", "sin_datos"],
      confianzaFinal: "dudosa",
      parametroFinal: null,
    },
  },
];

export const buscarHistoria = (nombre: string): Historia | undefined =>
  HISTORIAS.find((e) => e.nombre === nombre);

/** Generador xorshift32: la misma semilla produce siempre la misma historia. */
export function crearAzar(semilla: number): () => number {
  let s = semilla >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff - 0.5;
  };
}

/** Las mediciones (con ruido de sensor) de cada lectura del escenario. */
export function medicionesDeHistoria(e: Historia, semilla = 7): Mediciones[] {
  const azar = crearAzar(semilla);
  return Array.from({ length: e.lecturas }, (_, i) => {
    const centros = { ...BASE, ...e.centros(i) };
    const m = { ...nulas };
    for (const p of PARAMETROS) {
      const centro = centros[p];
      const ruido = azar() * 2 * (RUIDO[p] as number);
      if (centro === null) continue;
      const x = Number((centro + ruido).toFixed(DECIMALES[p] as number));
      m[p] = p === "turbidez" ? Math.max(0, x) : x;
    }
    return { ...m, ...(e.exactos?.(i) ?? {}) };
  });
}

/** Mediciones → campos de la telemetría del contrato MQTT v1. */
export function aTelemetria(m: Mediciones): Omit<Telemetria, "v" | "ts" | "seq"> {
  return { ph: m.ph, t: m.temperatura, ec: m.conductividad, turb: m.turbidez, tds: m.tds };
}
