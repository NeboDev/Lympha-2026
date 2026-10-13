import { createHash, randomBytes } from "node:crypto";
import type { EspacioApi, RolEspacio, TipoEspacio } from "@lympha/contracts";
import { sql } from "drizzle-orm";
import type { Tx } from "../../platform/db.ts";

const INVITACION_VIGENCIA_DIAS = 7;

export const hashToken = (token: string): Buffer => createHash("sha256").update(token).digest();

type FilaEspacio = {
  id: string;
  nombre: string;
  tipo: TipoEspacio;
  rol: RolEspacio;
  compartir_zona: boolean;
  zona_geohash: string | null;
  nodos: string;
};

const aEspacio = (f: FilaEspacio): EspacioApi => ({ ...f, nodos: Number(f.nodos) });

const SELECT_ESPACIO = sql`
  SELECT e.id, e.nombre, e.tipo, m.rol, e.compartir_zona, e.zona_geohash,
         (SELECT count(*) FROM app.nodos n WHERE n.espacio_id = e.id) AS nodos
  FROM app.espacios e
  JOIN app.membresias m ON m.espacio_id = e.id AND m.usuario_id = app.usuario_actual()`;

export async function crearEspacio(
  tx: Tx,
  datos: { nombre: string; tipo: TipoEspacio },
): Promise<EspacioApi> {
  const r = await tx.execute<{ id: string }>(
    sql`SELECT app.crear_espacio(${datos.nombre}, ${datos.tipo}) AS id`,
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("crear_espacio no devolvió un id");
  const espacio = await obtenerEspacio(tx, id);
  if (!espacio) throw new Error("el espacio recién creado no es visible");
  return espacio;
}

export async function listarEspacios(tx: Tx): Promise<EspacioApi[]> {
  const r = await tx.execute<FilaEspacio>(sql`${SELECT_ESPACIO} ORDER BY e.creado_en, e.id`);
  return r.rows.map(aEspacio);
}

export async function obtenerEspacio(tx: Tx, espacioId: string): Promise<EspacioApi | null> {
  const r = await tx.execute<FilaEspacio>(sql`${SELECT_ESPACIO} WHERE e.id = ${espacioId}`);
  const fila = r.rows[0];
  return fila ? aEspacio(fila) : null;
}

export async function listarMiembros(tx: Tx, espacioId: string) {
  const r = await tx.execute<{
    usuario_id: string;
    nombre: string | null;
    rol: RolEspacio;
    desde: Date;
  }>(sql`SELECT usuario_id, nombre, rol, desde FROM app.miembros_espacio(${espacioId})`);
  return r.rows.map((f) => ({ ...f, desde: new Date(f.desde).toISOString() }));
}

export interface CambiosEspacio {
  nombre?: string | undefined;
  tipo?: TipoEspacio | undefined;
  compartirZona?: boolean | undefined;
  zonaGeohash?: string | null | undefined;
}

export async function actualizarEspacio(
  tx: Tx,
  espacioId: string,
  c: CambiosEspacio,
): Promise<void> {
  const cambios = [
    c.nombre !== undefined ? sql`nombre = ${c.nombre}` : null,
    c.tipo !== undefined ? sql`tipo = ${c.tipo}` : null,
    c.compartirZona !== undefined ? sql`compartir_zona = ${c.compartirZona}` : null,
    c.zonaGeohash !== undefined ? sql`zona_geohash = ${c.zonaGeohash}` : null,
  ].filter((x) => x !== null);
  if (cambios.length === 0) return;
  await tx.execute(
    sql`UPDATE app.espacios SET ${sql.join(cambios, sql`, `)} WHERE id = ${espacioId}`,
  );
}

export async function crearInvitacion(
  tx: Tx,
  espacioId: string,
): Promise<{ token: string; expira_en: string }> {
  const token = randomBytes(32).toString("base64url");
  const expira = new Date(Date.now() + INVITACION_VIGENCIA_DIAS * 24 * 3600 * 1000);
  await tx.execute(sql`
    INSERT INTO app.invitaciones (espacio_id, token_hash, creada_por, expira_en)
    VALUES (${espacioId}, ${hashToken(token)}, app.usuario_actual(), ${expira.toISOString()}::timestamptz)`);
  return { token, expira_en: expira.toISOString() };
}

export async function aceptarInvitacion(tx: Tx, token: string): Promise<string> {
  const r = await tx.execute<{ id: string }>(
    sql`SELECT app.aceptar_invitacion(${hashToken(token)}) AS id`,
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error("aceptar_invitacion no devolvió un espacio");
  return id;
}

export async function transferirPropiedad(tx: Tx, espacioId: string, usuarioId: string) {
  await tx.execute(sql`SELECT app.transferir_propiedad(${espacioId}, ${usuarioId})`);
}

/** Quita una membresía de miembro. El propietario no se quita: debe transferir antes. */
export async function quitarMiembro(
  tx: Tx,
  espacioId: string,
  usuarioId: string,
): Promise<boolean> {
  const r = await tx.execute(
    sql`DELETE FROM app.membresias WHERE espacio_id = ${espacioId} AND usuario_id = ${usuarioId} AND rol = 'miembro'`,
  );
  return (r.rowCount ?? 0) > 0;
}
