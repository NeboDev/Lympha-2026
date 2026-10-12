import { sql } from "drizzle-orm";
import { type BdSistema, conSistema } from "../../platform/db.ts";

export interface MetaNodo {
  /** `null` mientras el nodo no esté reclamado: nadie ve sus datos. */
  espacioId: string | null;
  perfilId: string;
  perfilVersion: number;
  estado: string;
}

/** Busca el nodo y su perfil. `null` si el deviceId no existe. */
export async function buscarMetaNodo(bd: BdSistema, nodoId: string): Promise<MetaNodo | null> {
  const r = await conSistema(bd, (tx) =>
    tx.execute<{
      espacio_id: string | null;
      perfil_id: string;
      perfil_version: number;
      estado: string;
    }>(sql`
      SELECT n.espacio_id, n.perfil_id, p.version AS perfil_version, n.estado
      FROM app.nodos n
      JOIN app.perfiles_uso p ON p.id = n.perfil_id
      WHERE n.id = ${nodoId}`),
  );
  const fila = r.rows[0];
  if (!fila) return null;
  return {
    espacioId: fila.espacio_id,
    perfilId: fila.perfil_id,
    perfilVersion: Number(fila.perfil_version),
    estado: fila.estado,
  };
}

/** Marca como `activo` a los nodos reclamados que ya publicaron su primera lectura. */
export async function activarNodosConLectura(bd: BdSistema, nodoIds: string[]): Promise<number> {
  if (nodoIds.length === 0) return 0;
  const r = await conSistema(bd, (tx) =>
    tx.execute(sql`
      UPDATE app.nodos SET estado = 'activo'
      WHERE estado = 'reclamado'
        AND id IN (${sql.join(
          nodoIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`),
  );
  return r.rowCount ?? 0;
}
