import type { Db, ObjectId } from "mongodb";
import type {
  AlmacenIngesta,
  EventoIngesta,
  MuestraDoc,
  ResultadoInsercion,
} from "../modulos/ingesta/index.ts";
import type { NodoDoc, UltimoNodo } from "../modulos/nodos/index.ts";

/** Implementación en MongoDB de lo que necesita la ingesta. */
export function crearAlmacenMongo(db: Db): AlmacenIngesta {
  const nodos = db.collection<NodoDoc>("nodos");
  const muestras = db.collection<MuestraDoc>("muestras");
  const eventos = db.collection<EventoIngesta>("eventos");

  return {
    async listarNodos() {
      return nodos.find({ "blynk.token_cifrado": { $exists: true } }).toArray();
    },

    async cargarVentana(nodoId: ObjectId, desde: Date) {
      return muestras
        .find({ nodo_id: nodoId, ts: { $gte: desde } }, { projection: { _id: 0, ts: 1, v: 1 } })
        .sort({ ts: 1 })
        .limit(2000)
        .toArray();
    },

    async insertarMuestra(muestra: MuestraDoc): Promise<ResultadoInsercion> {
      try {
        await muestras.insertOne({ ...muestra });
        return "insertada";
      } catch (e) {
        // 11000 = clave duplicada: ya existe esa (nodo, sesion, seq).
        if ((e as { code?: number }).code === 11000) return "duplicada";
        throw e;
      }
    },

    async guardarUltimo(nodoId: ObjectId, ultimo: UltimoNodo) {
      await nodos.updateOne({ _id: nodoId }, { $set: { ultimo } });
    },

    async registrarEvento(evento: EventoIngesta) {
      await eventos.insertOne({ ...evento });
    },
  };
}
