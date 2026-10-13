import type { RolEspacio } from "@lympha/contracts";
import { sql } from "drizzle-orm";
import type { Tx } from "../../platform/db.ts";
import { NoEncontrado, Prohibido } from "../../platform/errors.ts";

/**
 * Rol del usuario en el espacio, o `null` si no es miembro o el espacio no existe. Un espacio ajeno y uno
 * inexistente son indistinguibles a propósito (RNF-01).
 */
export async function rolEnEspacio(tx: Tx, espacioId: string): Promise<RolEspacio | null> {
  const r = await tx.execute<{ rol: RolEspacio }>(
    sql`SELECT rol FROM app.membresias WHERE espacio_id = ${espacioId} AND usuario_id = app.usuario_actual()`,
  );
  return r.rows[0]?.rol ?? null;
}

/** 404 si no es miembro; 403 si es miembro pero el rol no alcanza. */
export async function exigirRol(
  tx: Tx,
  espacioId: string,
  minimo: RolEspacio,
): Promise<RolEspacio> {
  const rol = await rolEnEspacio(tx, espacioId);
  if (rol === null) throw new NoEncontrado();
  if (minimo === "propietario" && rol !== "propietario") throw new Prohibido();
  return rol;
}
