import { type Db, ObjectId } from "mongodb";
import type { AlertaDoc } from "../modulos/alertas/index.ts";
import type { AlmacenBitacora, EventoBitacora } from "../modulos/bitacora/index.ts";
import type {
  AlmacenCalibraciones,
  CalibracionDoc,
  EventoCalibracion,
} from "../modulos/calibraciones/index.ts";
import type { AlmacenComunidades, ComunidadDoc } from "../modulos/comunidades/index.ts";
import type { AlmacenUsuarios } from "../modulos/identidad/index.ts";
import type { AlmacenNodos, EventoNodo, NodoDoc, PuntoSerie } from "../modulos/nodos/index.ts";

/** Adaptadores de MongoDB para lo que usa la API. Una función por módulo, todas sobre la misma base. */

export function crearAlmacenUsuariosMongo(db: Db): AlmacenUsuarios {
  const usuarios = db.collection<{
    _id: ObjectId;
    google_uid: string;
    nombre: string | null;
    correo: string;
    creado: Date;
  }>("usuarios");
  return {
    async registrar(u, ahora) {
      // Índice único en google_uid: si dos peticiones llegan a la vez, una inserta y la otra actualiza.
      await usuarios.updateOne(
        { google_uid: u.uid },
        {
          $set: { nombre: u.nombre, correo: u.correo },
          $setOnInsert: { _id: new ObjectId(), google_uid: u.uid, creado: ahora },
        },
        { upsert: true },
      );
    },
  };
}

export function crearAlmacenComunidadesMongo(db: Db): AlmacenComunidades {
  const comunidades = db.collection<ComunidadDoc>("comunidades");
  return {
    async insertar(c) {
      await comunidades.insertOne({ ...c });
    },
    async obtener(id) {
      return comunidades.findOne({ _id: id });
    },
    async deUsuario(uid) {
      return comunidades.find({ "miembros.uid": uid }).sort({ nombre: 1 }).toArray();
    },
    async contarResponsable(uid) {
      return comunidades.countDocuments({ miembros: { $elemMatch: { uid, rol: "responsable" } } });
    },
  };
}

const ID_PARAMETRO = /^[a-z][a-z0-9_]{0,39}$/;
const TIPOS_EVENTO_NODO = [
  "sin_datos",
  "reconexion",
  "bitacora",
  "calibracion",
  "actuador",
] as const;

export function crearAlmacenNodosMongo(db: Db): AlmacenNodos {
  const nodos = db.collection<NodoDoc>("nodos");
  const muestras = db.collection("muestras");
  const alertas = db.collection<AlertaDoc>("alertas");
  const eventos = db.collection<{
    nodo_id: ObjectId | null;
    comunidad_id: ObjectId;
    ts: Date;
    tipo: string;
    mensaje: string;
    autor_uid?: string | null;
  }>("eventos");

  return {
    async nodo(id) {
      return nodos.findOne({ _id: id });
    },
    async nodosDeComunidad(comunidadId) {
      return nodos.find({ comunidad_id: comunidadId }).sort({ nombre: 1 }).toArray();
    },
    async existeNombre(comunidadId, nombre) {
      return (await nodos.countDocuments({ comunidad_id: comunidadId, nombre }, { limit: 1 })) > 0;
    },
    async insertar(nodo) {
      await nodos.insertOne({ ...nodo });
    },

    async serie(nodoId, parametros, desde, hasta, pasoS) {
      // Los ids de parámetro vienen del catálogo, pero se vuelven nombres de campo de Mongo: se validan.
      const ids = parametros.filter((p) => ID_PARAMETRO.test(p));
      const acumuladores: Record<string, unknown> = { n: { $sum: 1 } };
      for (const p of ids) {
        acumuladores[`${p}_prom`] = { $avg: `$v.${p}` };
        acumuladores[`${p}_min`] = { $min: `$v.${p}` };
        acumuladores[`${p}_max`] = { $max: `$v.${p}` };
      }
      const filas = await muestras
        .aggregate<Record<string, unknown> & { _id: Date; n: number }>([
          { $match: { nodo_id: nodoId, ts: { $gte: desde, $lte: hasta } } },
          {
            $group: {
              _id: { $dateTrunc: { date: "$ts", unit: "second", binSize: pasoS } },
              ...acumuladores,
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();
      return filas.map((f): PuntoSerie => {
        const v: PuntoSerie["v"] = {};
        for (const p of ids) {
          const prom = f[`${p}_prom`];
          const min = f[`${p}_min`];
          const max = f[`${p}_max`];
          // Un tramo sin valores de este parámetro devuelve null: no se inventa un punto.
          if (typeof prom === "number" && typeof min === "number" && typeof max === "number") {
            v[p] = { prom, min, max };
          }
        }
        return { ts: f._id, n: f.n, v };
      });
    },

    async alertas(nodoId, desde, hasta, limite) {
      return alertas
        .find({
          nodo_id: nodoId,
          abierta: { $lte: hasta },
          $or: [{ cerrada: null }, { cerrada: { $gte: desde } }],
        })
        .sort({ abierta: -1 })
        .limit(limite)
        .toArray();
    },

    async eventos(nodoId, comunidadId, desde, hasta, limite) {
      const docs = await eventos
        .find(
          {
            comunidad_id: comunidadId,
            ts: { $gte: desde, $lte: hasta },
            tipo: { $in: [...TIPOS_EVENTO_NODO] },
            $or: [{ nodo_id: nodoId }, { nodo_id: null }],
          },
          { projection: { _id: 0, ts: 1, tipo: 1, mensaje: 1, autor_uid: 1 } },
        )
        .sort({ ts: -1 })
        .limit(limite)
        .toArray();
      return docs.map(
        (d): EventoNodo => ({
          ts: d.ts,
          tipo: d.tipo as EventoNodo["tipo"],
          mensaje: d.mensaje,
          autor_uid: d.autor_uid ?? null,
        }),
      );
    },
  };
}

export function crearAlmacenBitacoraMongo(db: Db): AlmacenBitacora {
  const eventos = db.collection<EventoBitacora>("eventos");
  return {
    async registrar(evento) {
      await eventos.insertOne({ ...evento });
    },
  };
}

export function crearAlmacenCalibracionesMongo(db: Db): AlmacenCalibraciones {
  const calibraciones = db.collection<CalibracionDoc>("calibraciones");
  const eventos = db.collection<EventoCalibracion>("eventos");
  return {
    // Sin transacción (el Mongo local de respaldo es de un solo nodo y no las admite): primero la
    // calibración, que es lo que importa; si el evento falla, el reporte igual la muestra.
    async registrar(calibracion, evento) {
      await calibraciones.insertOne({ ...calibracion });
      await eventos.insertOne({ ...evento });
    },
    async listar(nodoId, limite) {
      return calibraciones.find({ nodo_id: nodoId }).sort({ ts: -1 }).limit(limite).toArray();
    },
  };
}
