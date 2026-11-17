import type { ObjectId } from "mongodb";
import type { AlertaDoc } from "../alertas/index.ts";
import type { Estado } from "../evaluacion/index.ts";
import type { NodoDoc } from "../nodos/index.ts";

/** Lo mínimo de una muestra que el reporte necesita (se lee con proyección, sin el resto). */
export type MuestraReporte = {
  ts: Date;
  v: Record<string, number>;
  estados?: Record<string, Estado>;
};

export type CalibracionDoc = {
  _id: ObjectId;
  nodo_id: ObjectId;
  ts: Date;
  parametro: string;
  pendiente_pct_nernst: number | null;
  offset_mv: number | null;
  diagnostico: string | null;
};

/** Eventos del registro que el reporte muestra (las alertas salen de la colección `alertas`). */
export type EventoReporte = {
  ts: Date;
  tipo: "sin_datos" | "reconexion" | "bitacora" | "actuador";
  mensaje: string;
};

export type ReporteDoc = {
  _id: ObjectId;
  nodo_id: ObjectId;
  comunidad_id: ObjectId;
  desde: Date;
  hasta: Date;
  generado: Date;
  generado_por: string;
  resumen: {
    parametros: Record<
      string,
      {
        prom: number | null;
        min: number | null;
        max: number | null;
        pct_en_rango: number | null;
        n: number;
      }
    >;
    cobertura_pct: number;
    alertas: number;
  };
  /** «sha256:…» del contenido (datos y periodo), no de los bytes del PDF. */
  hash: string;
};

/** Lo que el reporte necesita de la base. La implementación real está en `plataforma/`. */
export interface AlmacenReportes {
  nodo(id: ObjectId): Promise<NodoDoc | null>;
  comunidad(id: ObjectId): Promise<{ _id: ObjectId; nombre: string } | null>;
  /** Muestras con `desde <= ts <= hasta`, ordenadas por `ts` ascendente. */
  muestras(nodoId: ObjectId, desde: Date, hasta: Date): Promise<MuestraReporte[]>;
  /** Alertas que estuvieron abiertas en algún momento del periodo, por apertura ascendente. */
  alertas(nodoId: ObjectId, desde: Date, hasta: Date): Promise<AlertaDoc[]>;
  /** Eventos de la comunidad (o de este nodo) dentro del periodo, por `ts` ascendente. */
  eventos(
    comunidadId: ObjectId,
    nodoId: ObjectId,
    desde: Date,
    hasta: Date,
  ): Promise<EventoReporte[]>;
  calibraciones(nodoId: ObjectId, desde: Date, hasta: Date): Promise<CalibracionDoc[]>;
  guardarReporte(doc: ReporteDoc): Promise<void>;
}
