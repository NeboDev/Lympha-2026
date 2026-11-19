import type { MapeoPines } from "../nodos/index.ts";
import type { Snapshot } from "./puertos.ts";

/** Memoria mínima del sondeo de un nodo entre un ciclo y el siguiente. */
export type EstadoCiclo = {
  /** Último `seq` aceptado; null si aún no se acepta ninguno. */
  seq: number | null;
  sesion: number;
  /** Cuándo cambió `seq` por última vez. */
  ultimoCambio: Date | null;
  /** `true` si ya se avisó que el nodo dejó de enviar datos. */
  sinDatos: boolean;
};

export type MuestraNueva = {
  ts: Date;
  seq: number;
  sesion: number;
  v: Record<string, number>;
  crudo: Record<string, number>;
  estadoNodo: number | null;
  estableNodo: boolean | null;
  /** Pendiente de la sonda (% de Nernst) que reporta el nodo, o null si no la reporta o no es creíble. */
  calPct: number | null;
};

/** Una pendiente de sonda creíble: mayor que 0 y no mayor que 150 % (el 0 es «nunca se calibró»). */
export const CAL_PCT_MAX = 150;

export type ResultadoCiclo =
  | {
      tipo: "muestra";
      muestra: MuestraNueva;
      /** `reconexion` si el nodo estaba dado por detenido; `reinicio` si su `seq` bajó. */
      evento: "reconexion" | null;
      reinicio: boolean;
      siguiente: EstadoCiclo;
    }
  | {
      tipo: "sin_cambio";
      /** `sin_datos` solo la primera vez que se cruza el umbral. */
      evento: "sin_datos" | null;
      /** Segundos desde el último cambio de `seq`. */
      silencioS: number;
      siguiente: EstadoCiclo;
    }
  | { tipo: "invalida"; motivo: string; siguiente: EstadoCiclo };

export const ESTADO_CICLO_INICIAL: EstadoCiclo = {
  seq: null,
  sesion: 0,
  ultimoCambio: null,
  sinDatos: false,
};

function numero(valor: number | string | undefined): number | null {
  if (valor === undefined || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

function recoger(snapshot: Snapshot, pines: Record<string, string>): Record<string, number> {
  const salida: Record<string, number> = {};
  for (const [id, pin] of Object.entries(pines)) {
    const n = numero(snapshot[pin.toLowerCase()]);
    if (n !== null) salida[id] = n;
  }
  return salida;
}

/**
 * Decide qué hacer con una lectura de Blynk. Pura: no toca red ni base.
 * El `seq` que publica el nodo en cada muestra es la señal de vida: si no cambia, el nodo está
 * detenido (Blynk conserva el último valor aunque la placa se haya apagado).
 */
export function decidirCiclo(args: {
  estado: EstadoCiclo;
  snapshot: Snapshot;
  mapeo: MapeoPines;
  ahora: Date;
  sinDatosS: number;
}): ResultadoCiclo {
  const { estado, snapshot, mapeo, ahora, sinDatosS } = args;
  const seq = numero(snapshot[mapeo.seq.toLowerCase()]);
  if (seq === null || !Number.isInteger(seq) || seq < 0) {
    return { tipo: "invalida", motivo: "seq ausente o no válido", siguiente: estado };
  }

  if (estado.seq !== null && seq === estado.seq) {
    const referencia = estado.ultimoCambio ?? ahora;
    const silencioS = Math.max(0, (ahora.getTime() - referencia.getTime()) / 1000);
    const avisar = !estado.sinDatos && silencioS > sinDatosS;
    return {
      tipo: "sin_cambio",
      evento: avisar ? "sin_datos" : null,
      silencioS,
      siguiente: avisar ? { ...estado, sinDatos: true } : estado,
    };
  }

  const reinicio = estado.seq !== null && seq < estado.seq;
  const sesion = reinicio ? estado.sesion + 1 : estado.sesion;
  const estable = numero(snapshot[mapeo.estable.toLowerCase()]);
  const estadoNodo = numero(snapshot[mapeo.estado.toLowerCase()]);
  const calCruda = mapeo.cal_pct ? numero(snapshot[mapeo.cal_pct.toLowerCase()]) : null;
  const calPct = calCruda !== null && calCruda > 0 && calCruda <= CAL_PCT_MAX ? calCruda : null;
  return {
    tipo: "muestra",
    muestra: {
      ts: ahora,
      seq,
      sesion,
      v: recoger(snapshot, mapeo.valores),
      crudo: recoger(snapshot, mapeo.crudos),
      estadoNodo,
      estableNodo: estable === null ? null : estable === 1,
      calPct,
    },
    evento: estado.sinDatos ? "reconexion" : null,
    reinicio,
    siguiente: { seq, sesion, ultimoCambio: ahora, sinDatos: false },
  };
}
