import type { Db, ObjectId } from "mongodb";
import type { NodoDoc } from "../modulos/nodos/index.ts";
import type { AlmacenTelegram, DatosChat } from "../modulos/telegram/index.ts";

type ComunidadDoc = {
  _id: ObjectId;
  nombre: string;
  telegram?: (DatosChat & { vinculado: Date }) | null;
};

type VinculoPendiente = {
  token: string;
  tipo: "telegram";
  comunidad_id: ObjectId;
  expira: Date;
};

/** Vinculación de Telegram y consulta de estado en MongoDB. */
export function crearAlmacenTelegramMongo(db: Db): AlmacenTelegram {
  const comunidades = db.collection<ComunidadDoc>("comunidades");
  const pendientes = db.collection<VinculoPendiente>("vinculos_pendientes");
  const nodos = db.collection<NodoDoc>("nodos");

  return {
    async guardarToken(t) {
      await pendientes.insertOne({
        token: t.token,
        tipo: "telegram",
        comunidad_id: t.comunidad_id,
        expira: t.expira,
      });
    },

    async canjearToken(token, ahora) {
      // Se borra al leerlo: dos aperturas simultáneas del mismo enlace no vinculan dos chats.
      const doc = await pendientes.findOneAndDelete({
        token,
        tipo: "telegram",
        expira: { $gt: ahora },
      });
      return doc ? { comunidad_id: doc.comunidad_id } : null;
    },

    async vincularChat(comunidadId, chat, ahora) {
      const comunidad = await comunidades.findOne({ _id: comunidadId });
      if (!comunidad) return { resultado: "comunidad_inexistente" };
      try {
        await comunidades.updateOne(
          { _id: comunidadId },
          { $set: { telegram: { ...chat, vinculado: ahora } } },
        );
      } catch (e) {
        // Índice único parcial sobre telegram.chat_id: ese chat ya es de otra comunidad.
        if ((e as { code?: number }).code === 11000) return { resultado: "chat_ocupado" };
        throw e;
      }
      return { resultado: "ok", comunidad: comunidad.nombre };
    },

    async comunidadDeChat(chatId) {
      const c = await comunidades.findOne({ "telegram.chat_id": chatId });
      if (!c) return null;
      return { _id: c._id, nombre: c.nombre, vinculado_por: c.telegram?.vinculado_por ?? null };
    },

    async desvincularChat(chatId) {
      const r = await comunidades.updateOne(
        { "telegram.chat_id": chatId },
        { $set: { telegram: null } },
      );
      return r.matchedCount > 0;
    },

    async nodosDeComunidad(comunidadId) {
      return nodos
        .find({ comunidad_id: comunidadId, archivado: { $exists: false } })
        .sort({ creado: 1 })
        .toArray();
    },
  };
}
