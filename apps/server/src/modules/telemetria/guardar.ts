import { type BdSistema, conSistema } from "../../platform/db.ts";
import { activarNodosConLectura } from "../dispositivos/index.ts";
import type { LecturaTrabajo } from "./schema.ts";
import { lecturas } from "./tablas.ts";

const FILAS_POR_INSERT = 500;

export interface ResultadoGuardado {
  recibidas: number;
  insertadas: number;
  duplicadas: number;
}

/** Orden de escritura: por nodo y, dentro de cada nodo, por hora del nodo. */
export function ordenarLecturas(filas: LecturaTrabajo[]): LecturaTrabajo[] {
  return [...filas].sort((a, b) =>
    a.nodoId === b.nodoId ? a.ts - b.ts || a.seq - b.seq : a.nodoId < b.nodoId ? -1 : 1,
  );
}

/**
 * Guarda un lote de lecturas con `INSERT ... ON CONFLICT (nodo_id, ts) DO NOTHING`, así un reintento
 * del broker, de la cola o del worker es un no-op. Todo el lote va en una transacción.
 */
export async function guardarLecturas(
  bd: BdSistema,
  filas: LecturaTrabajo[],
): Promise<ResultadoGuardado> {
  const ordenadas = ordenarLecturas(filas);
  let insertadas = 0;
  await conSistema(bd, async (tx) => {
    for (let i = 0; i < ordenadas.length; i += FILAS_POR_INSERT) {
      const trozo = ordenadas.slice(i, i + FILAS_POR_INSERT).map((l) => ({
        nodoId: l.nodoId,
        espacioId: l.espacioId,
        ts: new Date(l.ts),
        seq: l.seq,
        ph: l.ph,
        temperatura: l.temperatura,
        conductividad: l.conductividad,
        turbidez: l.turbidez,
        tds: l.tds,
        recibidoEn: new Date(l.recibidoEn),
      }));
      const r = await tx
        .insert(lecturas)
        .values(trozo)
        .onConflictDoNothing({ target: [lecturas.nodoId, lecturas.ts] });
      insertadas += r.rowCount ?? 0;
    }
  });
  await activarNodosConLectura(bd, [...new Set(ordenadas.map((l) => l.nodoId))]);
  return { recibidas: ordenadas.length, insertadas, duplicadas: ordenadas.length - insertadas };
}
