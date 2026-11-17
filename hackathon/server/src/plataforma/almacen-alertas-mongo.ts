import type { Db, ObjectId } from "mongodb";
import type {
  AlertaDoc,
  AlmacenAlertas,
  EventoAlerta,
  SeveridadAlerta,
} from "../modulos/alertas/index.ts";
import type { NodoDoc } from "../modulos/nodos/index.ts";
import type { AlmacenAvisos, AvisoDoc } from "../modulos/notificaciones/index.ts";

const esDuplicado = (e: unknown) => (e as { code?: number }).code === 11000;

/** Alertas y bandeja de avisos en MongoDB. Cada operación condicional es atómica e idempotente. */
export function crearAlmacenAlertasMongo(db: Db): AlmacenAlertas & AlmacenAvisos {
  const alertas = db.collection<AlertaDoc>("alertas");
  const avisos = db.collection<AvisoDoc>("avisos");
  const nodos = db.collection<NodoDoc>("nodos");
  const eventos = db.collection<EventoAlerta>("eventos");
  const comunidades = db.collection<{ _id: ObjectId; telegram?: { chat_id?: number } | null }>(
    "comunidades",
  );

  return {
    /* ---- AlmacenAlertas ---- */
    async alertasAbiertasDeNodo(nodoId) {
      return alertas.find({ nodo_id: nodoId, estado: "abierta" }).toArray();
    },

    async alertasAbiertas() {
      return alertas.find({ estado: "abierta" }).toArray();
    },

    async nodo(id) {
      return nodos.findOne({ _id: id });
    },

    async hayChat(comunidadId) {
      const n = await comunidades.countDocuments(
        { _id: comunidadId, "telegram.chat_id": { $type: "number" } },
        { limit: 1 },
      );
      return n > 0;
    },

    async insertarAlerta(alerta) {
      try {
        await alertas.insertOne({ ...alerta });
        return "insertada";
      } catch (e) {
        // Índice único parcial (nodo, tipo, parámetro) entre las abiertas.
        if (esDuplicado(e)) return "duplicada";
        throw e;
      }
    },

    async cerrarAlerta(id, ts, valor) {
      const r = await alertas.updateOne(
        { _id: id, estado: "abierta" },
        { $set: { estado: "cerrada", cerrada: ts, valor_cierre: valor } },
      );
      return r.modifiedCount === 1;
    },

    async cambiarSeveridad(
      id,
      desde: SeveridadAlerta,
      a: SeveridadAlerta,
      maxima: SeveridadAlerta,
    ) {
      const r = await alertas.updateOne(
        { _id: id, estado: "abierta", severidad: desde },
        { $set: { severidad: a, severidad_maxima: maxima } },
      );
      return r.modifiedCount === 1;
    },

    async marcarAviso(id, ts, recordatorios) {
      await alertas.updateOne(
        { _id: id },
        {
          $set:
            recordatorios === undefined
              ? { ultimo_aviso: ts }
              : { ultimo_aviso: ts, recordatorios },
        },
      );
    },

    async encolarAviso(aviso) {
      try {
        await avisos.insertOne({ ...aviso });
        return "encolado";
      } catch (e) {
        if (esDuplicado(e)) return "duplicado";
        throw e;
      }
    },

    async registrarEvento(evento) {
      await eventos.insertOne({ ...evento });
    },

    /* ---- AlmacenAvisos ---- */
    async tomarSiguiente(ahora, arriendoMs) {
      return avisos.findOneAndUpdate(
        {
          estado: "pendiente",
          proximo_intento: { $lte: ahora },
          $or: [{ bloqueado_hasta: null }, { bloqueado_hasta: { $lt: ahora } }],
        },
        { $set: { bloqueado_hasta: new Date(ahora.getTime() + arriendoMs) } },
        { sort: { creado: 1 }, returnDocument: "after" },
      );
    },

    async marcarEnviado(id, ahora) {
      await avisos.updateOne(
        { _id: id },
        {
          $set: { estado: "enviado", enviado: ahora, bloqueado_hasta: null, ultimo_error: null },
          $inc: { intentos: 1 },
        },
      );
    },

    async reprogramar(id, proximoIntento, error) {
      await avisos.updateOne(
        { _id: id },
        {
          $set: { proximo_intento: proximoIntento, ultimo_error: error, bloqueado_hasta: null },
          $inc: { intentos: 1 },
        },
      );
    },

    async marcarFallido(id, error) {
      await avisos.updateOne(
        { _id: id },
        {
          $set: { estado: "fallido", ultimo_error: error, bloqueado_hasta: null },
          $inc: { intentos: 1 },
        },
      );
    },

    async chatDe(comunidadId) {
      const c = await comunidades.findOne({ _id: comunidadId }, { projection: { telegram: 1 } });
      const chat = c?.telegram?.chat_id;
      return typeof chat === "number" ? chat : null;
    },
  };
}
