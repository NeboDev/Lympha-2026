import type { ObjectId } from "mongodb";
import type { AlertaDoc } from "../alertas/index.ts";
import type { NodoDoc } from "./tipos.ts";

/** Resumen de un tramo de la serie: promedio, mínimo y máximo de cada parámetro. */
export type PuntoSerie = {
  ts: Date;
  /** Muestras que cayeron en el tramo. */
  n: number;
  v: Record<string, { prom: number; min: number; max: number }>;
};

export type EventoNodo = {
  ts: Date;
  tipo: "sin_datos" | "reconexion" | "bitacora" | "calibracion" | "actuador";
  mensaje: string;
  autor_uid: string | null;
};

export interface AlmacenNodos {
  nodo(id: ObjectId): Promise<NodoDoc | null>;
  nodosDeComunidad(comunidadId: ObjectId): Promise<NodoDoc[]>;
  existeNombre(comunidadId: ObjectId, nombre: string): Promise<boolean>;
  insertar(nodo: NodoDoc): Promise<void>;
  /** Serie agregada por tramos de `pasoS` segundos, por hora ascendente. */
  serie(
    nodoId: ObjectId,
    parametros: string[],
    desde: Date,
    hasta: Date,
    pasoS: number,
  ): Promise<PuntoSerie[]>;
  /** Alertas abiertas en algún momento del periodo, las más recientes primero. */
  alertas(nodoId: ObjectId, desde: Date, hasta: Date, limite: number): Promise<AlertaDoc[]>;
  /** Eventos del nodo (y de la comunidad sin nodo, como la bitácora) del periodo, recientes primero. */
  eventos(
    nodoId: ObjectId,
    comunidadId: ObjectId,
    desde: Date,
    hasta: Date,
    limite: number,
  ): Promise<EventoNodo[]>;
}

export type ResultadoToken = "conectado" | "desconectado" | "invalido" | "sin_respuesta";

/** Comprueba un token de Blynk sin guardar nada. La implementación real habla con Blynk. */
export interface ComprobadorToken {
  comprobar(token: string): Promise<ResultadoToken>;
}
