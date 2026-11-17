import type { ObjectId } from "mongodb";
import type { Estado } from "../evaluacion/index.ts";
import type { DetalleParametro, NodoDoc, UltimoNodo } from "../nodos/index.ts";

/** Valores de todos los pines del nodo, tal como los devuelve Blynk (`getAll`). */
export type Snapshot = Record<string, number | string>;

/** Lee el estado actual de un nodo. La implementación real habla con Blynk. */
export interface LectorNodo {
  leer(nodo: NodoDoc): Promise<Snapshot>;
}

export type MuestraDoc = {
  nodo_id: ObjectId;
  /** Hora del sondeo (Blynk no da marca de tiempo al leer). */
  ts: Date;
  seq: number;
  /** Cambia cuando el nodo se reinicia y su `seq` vuelve a empezar. */
  sesion: number;
  v: Record<string, number>;
  crudo: Record<string, number>;
  /** Peor estado evaluado, o null si no se pudo evaluar nada. */
  estado: Estado | null;
  estados: Record<string, Estado>;
  detalles: Record<string, DetalleParametro>;
  estable: boolean | null;
  /** V4 tal como lo reportó el nodo (0 ok · 1 atención · 2 fuera · 3 error de sensor). */
  estado_nodo: number | null;
};

export type EventoIngesta = {
  nodo_id: ObjectId;
  comunidad_id: ObjectId;
  ts: Date;
  tipo: "sin_datos" | "reconexion";
  severidad: "info" | "atencion" | "alta";
  parametro: string | null;
  mensaje: string;
  datos: Record<string, unknown>;
  autor_uid: null;
};

export type ResultadoInsercion = "insertada" | "duplicada";

/** Lo que la ingesta necesita de la base. La implementación real está en `plataforma/`. */
export interface AlmacenIngesta {
  listarNodos(): Promise<NodoDoc[]>;
  /** Muestras recientes (ts, v) para sembrar la ventana de evaluación al arrancar. */
  cargarVentana(nodoId: ObjectId, desde: Date): Promise<Pick<MuestraDoc, "ts" | "v">[]>;
  insertarMuestra(muestra: MuestraDoc): Promise<ResultadoInsercion>;
  guardarUltimo(nodoId: ObjectId, ultimo: UltimoNodo): Promise<void>;
  registrarEvento(evento: EventoIngesta): Promise<void>;
}

/** Lo que cambió en un nodo tras un sondeo: las alertas se reconcilian contra esta foto. */
export type CambioNodo = { nodo: NodoDoc; ultimo: UltimoNodo; ahora: Date };

/** Subconjunto de pino: lo que la ingesta registra. */
export type LoggerIngesta = {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
};
