import type { Db, ObjectId } from "mongodb";
import type { AlertaDoc } from "../modulos/alertas/index.ts";
import type { NodoDoc } from "../modulos/nodos/index.ts";
import type {
  AlmacenReportes,
  CalibracionDoc,
  EventoReporte,
  MuestraReporte,
  ReporteDoc,
} from "../modulos/reportes/index.ts";

/** Lectura de lo que el reporte necesita y registro de cada reporte generado. */
export function crearAlmacenReportesMongo(db: Db): AlmacenReportes {
  const nodos = db.collection<NodoDoc>("nodos");
  const comunidades = db.collection<{ _id: ObjectId; nombre: string }>("comunidades");
  const muestras = db.collection<MuestraReporte>("muestras");
  const alertas = db.collection<AlertaDoc>("alertas");
  const eventos = db.collection<EventoReporte & { nodo_id: unknown; comunidad_id: unknown }>(
    "eventos",
  );
  const calibraciones = db.collection<CalibracionDoc>("calibraciones");
  const reportes = db.collection<ReporteDoc>("reportes");

  return {
    async nodo(id) {
      return nodos.findOne({ _id: id, archivado: { $exists: false } });
    },

    async comunidad(id) {
      return comunidades.findOne({ _id: id }, { projection: { _id: 1, nombre: 1 } });
    },

    async muestras(nodoId, desde, hasta) {
      return muestras
        .find(
          { nodo_id: nodoId, ts: { $gte: desde, $lte: hasta } },
          { projection: { _id: 0, ts: 1, v: 1, estados: 1 } },
        )
        .sort({ ts: 1 })
        .toArray();
    },

    async alertas(nodoId, desde, hasta) {
      // Abierta antes de que termine el periodo y todavía abierta (o cerrada) después de que empezó.
      return alertas
        .find({
          nodo_id: nodoId,
          abierta: { $lte: hasta },
          $or: [{ cerrada: null }, { cerrada: { $gte: desde } }],
        })
        .sort({ abierta: 1 })
        .toArray();
    },

    async eventos(comunidadId, nodoId, desde, hasta) {
      // La bitácora es de la comunidad (sin nodo); los demás eventos, de este nodo.
      const docs = await eventos
        .find(
          {
            comunidad_id: comunidadId,
            ts: { $gte: desde, $lte: hasta },
            tipo: { $in: ["sin_datos", "reconexion", "bitacora", "actuador"] },
            $or: [{ nodo_id: nodoId }, { nodo_id: null }],
          },
          { projection: { _id: 0, ts: 1, tipo: 1, mensaje: 1 } },
        )
        .sort({ ts: 1 })
        .toArray();
      return docs.map((d) => ({ ts: d.ts, tipo: d.tipo, mensaje: d.mensaje }));
    },

    async calibraciones(nodoId, desde, hasta) {
      return calibraciones
        .find({ nodo_id: nodoId, ts: { $gte: desde, $lte: hasta } })
        .sort({ ts: 1 })
        .toArray();
    },

    async recientes(nodoId, limite) {
      return reportes.find({ nodo_id: nodoId }).sort({ generado: -1 }).limit(limite).toArray();
    },

    async guardarReporte(doc) {
      await reportes.insertOne({ ...doc });
    },
  };
}
