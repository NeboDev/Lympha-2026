import { sql } from "drizzle-orm";
import { type BdSistema, conSistema, type Tx } from "../../platform/db.ts";
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
 * Deja en `estado_nodo` la última lectura de cada nodo del lote (la API la muestra mientras H2 no calcula el
 * WQI). Solo avanza hacia lecturas más recientes y solo si el nodo sigue en el mismo espacio.
 */
async function actualizarUltimaLectura(tx: Tx, ordenadas: LecturaTrabajo[]): Promise<void> {
  const ultima = new Map<string, LecturaTrabajo>();
  for (const l of ordenadas) ultima.set(l.nodoId, l); // ordenadas por (nodo, ts): la última gana
  if (ultima.size === 0) return;
  const filas = [...ultima.values()].map(
    (
      l,
    ) => sql`(${l.nodoId}::uuid, ${l.espacioId}::uuid, ${new Date(l.ts).toISOString()}::timestamptz,
      ${JSON.stringify({ ph: l.ph, temperatura: l.temperatura, conductividad: l.conductividad, turbidez: l.turbidez, tds: l.tds })}::jsonb)`,
  );
  await tx.execute(sql`
    UPDATE app.estado_nodo e
    SET ultima_lectura_en = v.ts, ultimos_valores = v.valores, actualizado_en = now()
    FROM (VALUES ${sql.join(filas, sql`, `)}) AS v(nodo_id, espacio_id, ts, valores)
    WHERE e.nodo_id = v.nodo_id AND e.espacio_id = v.espacio_id
      AND (e.ultima_lectura_en IS NULL OR e.ultima_lectura_en < v.ts)`);
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
    await actualizarUltimaLectura(tx, ordenadas);
  });
  await activarNodosConLectura(bd, [...new Set(ordenadas.map((l) => l.nodoId))]);
  return { recibidas: ordenadas.length, insertadas, duplicadas: ordenadas.length - insertadas };
}
