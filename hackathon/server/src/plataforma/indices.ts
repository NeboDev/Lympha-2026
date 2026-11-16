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
  { coleccion: "nodos", clave: { comunidad_id: 1 } },
  { coleccion: "muestras", clave: { nodo_id: 1, ts: -1 } },
  {
    // Ingesta idempotente: una misma `seq` de un nodo no se inserta dos veces.
    coleccion: "muestras",
    clave: { nodo_id: 1, seq: 1 },
    opciones: { unique: true, partialFilterExpression: { seq: { $type: "number" } } },
  },
  { coleccion: "eventos", clave: { nodo_id: 1, ts: -1 } },
  { coleccion: "eventos", clave: { comunidad_id: 1, ts: -1 } },
  { coleccion: "calibraciones", clave: { nodo_id: 1, ts: -1 } },
  { coleccion: "reportes", clave: { nodo_id: 1, generado: -1 } },
  { coleccion: "vinculos_pendientes", clave: { token: 1 }, opciones: { unique: true } },
  { coleccion: "vinculos_pendientes", clave: { expira: 1 }, opciones: { expireAfterSeconds: 0 } },
];

export async function asegurarIndices(db: Db): Promise<number> {
  for (const d of definicionesIndices) {
    await db.collection(d.coleccion).createIndex(d.clave, d.opciones);
  }
  return definicionesIndices.length;
}
