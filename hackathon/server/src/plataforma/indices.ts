import type { Db, IndexSpecification } from "mongodb";

type DefinicionIndice = {
  coleccion: string;
  clave: IndexSpecification;
  opciones?: Record<string, unknown>;
};

/** Índices de ARQUITECTURA.md §7. Crearlos es idempotente. */
export const definicionesIndices: DefinicionIndice[] = [
  { coleccion: "usuarios", clave: { google_uid: 1 }, opciones: { unique: true } },
  { coleccion: "comunidades", clave: { "miembros.uid": 1 } },
  {
    // Un chat de Telegram solo puede pertenecer a una comunidad.
    coleccion: "comunidades",
    clave: { "telegram.chat_id": 1 },
    opciones: {
      unique: true,
      partialFilterExpression: { "telegram.chat_id": { $type: "number" } },
    },
  },
  { coleccion: "nodos", clave: { comunidad_id: 1 } },
  {
    // Una sola alerta abierta por (nodo, tipo, parámetro): abrir dos veces no duplica.
    coleccion: "alertas",
    clave: { nodo_id: 1, tipo: 1, parametro: 1 },
    opciones: { unique: true, partialFilterExpression: { estado: "abierta" } },
  },
  { coleccion: "alertas", clave: { comunidad_id: 1, abierta: -1 } },
  // La clave única de un aviso evita mandar dos veces lo mismo al reintentar.
  { coleccion: "avisos", clave: { clave: 1 }, opciones: { unique: true } },
  { coleccion: "avisos", clave: { estado: 1, proximo_intento: 1 } },
  { coleccion: "muestras", clave: { nodo_id: 1, ts: -1 } },
  {
    // Ingesta idempotente: una misma `seq` no se inserta dos veces dentro de una sesión del nodo.
    // Si el nodo se reinicia, su `seq` vuelve a 1: por eso la clave incluye la `sesion`.
    coleccion: "muestras",
    clave: { nodo_id: 1, sesion: 1, seq: 1 },
    opciones: { unique: true, partialFilterExpression: { seq: { $type: "number" } } },
  },
  { coleccion: "eventos", clave: { nodo_id: 1, ts: -1 } },
  { coleccion: "eventos", clave: { comunidad_id: 1, ts: -1 } },
  { coleccion: "calibraciones", clave: { nodo_id: 1, ts: -1 } },
  { coleccion: "reportes", clave: { nodo_id: 1, generado: -1 } },
  { coleccion: "vinculos_pendientes", clave: { token: 1 }, opciones: { unique: true } },
  { coleccion: "vinculos_pendientes", clave: { expira: 1 }, opciones: { expireAfterSeconds: 0 } },
];

/** Índices de versiones anteriores que estorban y se borran si existen. */
export const indicesObsoletos = [{ coleccion: "muestras", nombre: "nodo_id_1_seq_1" }];

export async function asegurarIndices(db: Db): Promise<number> {
  for (const o of indicesObsoletos) {
    try {
      await db.collection(o.coleccion).dropIndex(o.nombre);
    } catch (e) {
      const codigo = (e as { code?: number }).code;
      // 27 = IndexNotFound, 26 = NamespaceNotFound: no existía, está bien.
      if (codigo !== 27 && codigo !== 26) throw e;
    }
  }
  for (const d of definicionesIndices) {
    await db.collection(d.coleccion).createIndex(d.clave, d.opciones);
  }
  return definicionesIndices.length;
}
