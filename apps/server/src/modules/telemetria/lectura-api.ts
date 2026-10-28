import type { LecturaApi } from "@lympha/contracts";
import { sql } from "drizzle-orm";
import { type BdApp, conUsuario } from "../../platform/db.ts";

/**
 * Últimas lecturas de un nodo del usuario, o `null` si el nodo no existe o no es de sus espacios
 * (el llamador responde 404 en ambos casos: no se revela si el nodo existe). Las series de tiempo
 * se leen SOLO por app.v_lecturas.
 */
export async function ultimasLecturas(
  bd: BdApp,
  usuarioId: string,
  nodoId: string,
  limite: number,
): Promise<LecturaApi[] | null> {
  return conUsuario(bd, usuarioId, async (tx) => {
    const visible = await tx.execute(sql`SELECT 1 FROM app.nodos WHERE id = ${nodoId}`);
    if (visible.rows.length === 0) return null;
    const r = await tx.execute<{
      nodo_id: string;
      ts: Date;
      seq: number;
      ph: number | null;
      temperatura: number | null;
      conductividad: number | null;
      turbidez: number | null;
      tds: number | null;
      crudo: Record<string, number> | null;
    }>(sql`
      SELECT nodo_id, ts, seq, ph, temperatura, conductividad, turbidez, tds, crudo
      FROM app.v_lecturas
      WHERE nodo_id = ${nodoId}
      ORDER BY ts DESC
      LIMIT ${limite}`);
    return r.rows.map((f) => ({
      nodo_id: f.nodo_id,
      ts: new Date(f.ts).toISOString(),
      seq: f.seq,
      ph: f.ph,
      temperatura: f.temperatura,
      conductividad: f.conductividad,
      turbidez: f.turbidez,
      tds: f.tds,
      crudo: f.crudo,
    }));
  });
}
