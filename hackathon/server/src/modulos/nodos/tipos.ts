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
  /** Última pendiente de la sonda (% de Nernst) que reportó el nodo (V10). Ausente si nunca la ha reportado. */
  cal_pct?: number;
  sin_datos: boolean;
};

/**
 * El actuador (relevador de una bomba o válvula) de un nodo. Sin esto el nodo no tiene control: la web no
 * ofrece nada y la API lo rechaza. Los enclavamientos de verdad viven en el firmware; esto es lo que Atl
 * añade encima, nunca en lugar de ellos.
 */
export type ConfigActuador = {
  habilitado: boolean;
  /** Cómo se llama para la gente, p. ej. «Bomba de cloro». */
  nombre: string;
  /** Pin de Blynk del relevador (por omisión el de la plantilla, v8). */
  pin: string;
  /** Duración máxima de un pulso que Atl acepta pedir (el firmware tiene la suya). */
  pulso_max_s: number;
  /** Tiempo mínimo entre el final de un pulso y el siguiente. */
  enfriamiento_s: number;
  /** `true`: no hay relevador real conectado; se ensaya el flujo y todo se rotula «simulado». */
  simulado: boolean;
  /** Detener un pulso en curso si el pH sale de rango, la sonda falla o el nodo deja de enviar datos. */
  auto_detener: boolean;
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
  /** Ausente = el nodo no tiene actuador. */
  actuador?: ConfigActuador;
  creado: Date;
  /**
   * Presente = el nodo se quitó (borrado lógico): ya no se sondea, no sale en la API ni genera avisos, pero sus
   * muestras, alertas y bitácora se conservan como archivo.
   */
  archivado?: Date;
};
