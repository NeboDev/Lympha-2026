import type { ObjectId } from "mongodb";
import type { Estado } from "../evaluacion/index.ts";

/** Pines virtuales de Blynk de un nodo. Las claves de `valores` y `crudos` son ids del catálogo. */
export type MapeoPines = {
  valores: Record<string, string>;
  crudos: Record<string, string>;
  estado: string;
  estable: string;
  seq: string;
  bomba?: string;
  modo?: string;
  cal_pct?: string;
};

/** Detalle de la evaluación de un parámetro: lo que las alertas necesitan además del estado. */
export type DetalleParametro = {
  cambio_rapido: boolean;
  /** Mayor cambio (con signo) en la ventana de cambio rápido. */
  cambio: number | null;
  motivos_sensor: string[];
};

/** Última foto del nodo; la web y los avisos la leen sin tocar las muestras. */
export type UltimoNodo = {
  ts: Date;
  v: Record<string, number>;
  /** Peor estado de todos los parámetros evaluados. */
  estado: Estado | null;
  estados: Record<string, Estado>;
  /** Ausente en documentos anteriores al Paso 5. */
  detalles?: Record<string, DetalleParametro>;
  seq: number;
  sesion: number;
  estable: boolean | null;
  /** Momento en que `seq` cambió por última vez. */
  ultimo_cambio: Date;
  sin_datos: boolean;
};

export type UmbralesNodo = Record<string, { min: number | null; max: number | null }>;

export type NodoDoc = {
  _id: ObjectId;
  comunidad_id: ObjectId;
  nombre: string;
  ubicacion?: { texto: string; lat?: number; lng?: number };
  blynk: {
    host: string;
    /** AES-256-GCM; nunca sale por la API ni a los logs. */
    token_cifrado: string;
    plantilla: string;
    mapeo: MapeoPines;
  };
  /** Ids del catálogo que este nodo mide. */
  parametros: string[];
  /** Sustituyen a la norma del catálogo para este nodo, si se definen. */
  umbrales?: UmbralesNodo;
  ultimo: UltimoNodo | null;
  creado: Date;
};
