import type { Db, ObjectId } from "mongodb";
import {
  type AccionDoc,
  type AlmacenControl,
  ESTADOS_ACTIVOS,
  type EventoActuador,
} from "../modulos/control/index.ts";
import type { ConfigActuador, NodoDoc } from "../modulos/nodos/index.ts";

/** Acciones del actuador (pulsos) y su configuración en MongoDB. Cada cambio de estado es condicional y atómico. */
export function crearAlmacenControlMongo(db: Db): AlmacenControl {
  const acciones = db.collection<AccionDoc>("acciones_actuador");
  const nodos = db.collection<NodoDoc>("nodos");
  const eventos = db.collection<EventoActuador>("eventos");

  return {
    async guardarConfig(nodoId: ObjectId, config: ConfigActuador | null) {
      await nodos.updateOne(
        { _id: nodoId },
        config ? { $set: { actuador: config } } : { $unset: { actuador: "" } },
      );
    },

    async insertar(accion) {
      try {
        await acciones.insertOne({ ...accion });
        return "insertada";
      } catch (e) {
        // Índice único parcial: una sola acción pendiente o en curso por nodo.
        if ((e as { code?: number }).code === 11000) return "ocupado";
        throw e;
      }
    },

    async obtener(id, nodoId) {
      return acciones.findOne({ _id: id, nodo_id: nodoId });
    },

    async transicion(id, desde, cambios) {
      const r = await acciones.findOneAndUpdate(
        { _id: id, estado: { $in: [...desde] } },
        { $set: cambios },
        { returnDocument: "after" },
      );
      return r ?? null;
    },

    async activa(nodoId) {
      return acciones.findOne({ nodo_id: nodoId, estado: { $in: [...ESTADOS_ACTIVOS] } });
    },

    async ultimoFin(nodoId) {
      // Solo cuentan los pulsos que de verdad llegaron a mandarse (no los rechazados, cancelados ni fallidos).
      const r = await acciones
        .find({ nodo_id: nodoId, estado: { $in: ["terminada", "detenida"] }, fin: { $ne: null } })
        .sort({ fin: -1 })
        .limit(1)
        .toArray();
      return r[0]?.fin ?? null;
    },

    async recientes(nodoId, limite) {
      return acciones.find({ nodo_id: nodoId }).sort({ solicitada: -1 }).limit(limite).toArray();
    },

    async vencidas(ahora) {
      return acciones
        .find({
          $or: [
            { estado: "pendiente", expira: { $lte: ahora } },
            { estado: "en_curso", fin: { $lte: ahora } },
          ],
        })
        .limit(100)
        .toArray();
    },

    async nodo(id) {
      return nodos.findOne({ _id: id });
    },

    async registrarEvento(evento) {
      await eventos.insertOne({ ...evento });
    },
  };
}
