import type { AlarmaApi, EstadoAlarma, EventoAlarma } from "@lympha/contracts";
import { type SQL, sql } from "drizzle-orm";
import type { Tx } from "../../platform/db.ts";

/** Consultas de la API sobre las alarmas. Todas van por `conUsuario()`: la RLS limita a los espacios del usuario. */

interface FilaAlarmaApi extends Record<string, unknown> {
  id: string;
  nodo_id: string;
  nodo_nombre: string | null;
  espacio_id: string;
  tipo: AlarmaApi["tipo"];
  severidad: AlarmaApi["severidad"];
  estado: EstadoAlarma;
  causa: string | null;
  abierta_en: Date;
  escalada_en: Date | null;
  atendida_por: string | null;
  atendida_en: Date | null;
  resuelta_en: Date | null;
}

const iso = (d: Date | null): string | null => (d ? new Date(d).toISOString() : null);

/** Nombres de los miembros del espacio (nunca correos): `miembros_espacio` es la vía autorizada. */
async function nombresDeMiembros(tx: Tx, espacioId: string): Promise<Map<string, string | null>> {
  const r = await tx.execute<{ usuario_id: string; nombre: string | null }>(
    sql`SELECT usuario_id, nombre FROM app.miembros_espacio(${espacioId}::uuid)`,
  );
  return new Map(r.rows.map((f) => [f.usuario_id, f.nombre]));
}

const aApi = (f: FilaAlarmaApi, nombres: Map<string, string | null>): AlarmaApi => ({
  id: f.id,
  nodo_id: f.nodo_id,
  nodo_nombre: f.nodo_nombre,
  espacio_id: f.espacio_id,
  tipo: f.tipo,
  severidad: f.severidad,
  estado: f.estado,
  causa: f.causa,
  abierta_en: new Date(f.abierta_en).toISOString(),
  escalada_en: iso(f.escalada_en),
  atendida_por: f.atendida_por
    ? { id: f.atendida_por, nombre: nombres.get(f.atendida_por) ?? null }
    : null,
  atendida_en: iso(f.atendida_en),
  resuelta_en: iso(f.resuelta_en),
});

const COLUMNAS = sql`
  a.id, a.nodo_id, n.nombre AS nodo_nombre, a.espacio_id, a.tipo, a.severidad, a.estado, a.causa,
  a.abierta_en, a.escalada_en, a.atendida_por, a.atendida_en, a.resuelta_en`;

export async function listarAlarmas(
  tx: Tx,
  espacioId: string,
  filtro: { estado?: "abiertas" | EstadoAlarma | undefined; limite: number },
): Promise<AlarmaApi[]> {
  const donde: SQL =
    filtro.estado === undefined
      ? sql`TRUE`
      : filtro.estado === "abiertas"
        ? sql`a.estado <> 'resuelta'`
        : sql`a.estado = ${filtro.estado}::app.alarma_estado`;
  const r = await tx.execute<FilaAlarmaApi>(sql`
    SELECT ${COLUMNAS}
    FROM app.alarmas a JOIN app.nodos n ON n.id = a.nodo_id
    WHERE a.espacio_id = ${espacioId}::uuid AND ${donde}
    ORDER BY a.abierta_en DESC, a.id DESC
    LIMIT ${filtro.limite}`);
  const nombres = await nombresDeMiembros(tx, espacioId);
  return r.rows.map((f) => aApi(f, nombres));
}

export type ResultadoAtender =
  | { tipo: "atendida"; alarma: AlarmaApi; evento: EventoAlarma }
  | { tipo: "no_activa"; estado: EstadoAlarma }
  | { tipo: "inexistente" };

/**
 * Un miembro del espacio marca la alarma como atendida. Solo una alarma `activa` puede atenderse; si la alarma
 * no existe o es de un espacio ajeno, el resultado es el mismo (RNF-01). La condición `estado = 'activa'` va en
 * el propio UPDATE: dos personas que atienden a la vez no se pisan, gana una y la otra recibe un conflicto.
 */
export async function atenderAlarma(tx: Tx, alarmaId: string): Promise<ResultadoAtender> {
  const r = await tx.execute<{ id: string }>(sql`
    UPDATE app.alarmas
    SET estado = 'atendida', atendida_por = app.usuario_actual(), atendida_en = now()
    WHERE id = ${alarmaId}::uuid AND estado = 'activa'
    RETURNING id`);
  if (r.rows.length === 0) {
    const e = await tx.execute<{ estado: EstadoAlarma }>(
      sql`SELECT estado FROM app.alarmas WHERE id = ${alarmaId}::uuid`,
    );
    const fila = e.rows[0];
    return fila ? { tipo: "no_activa", estado: fila.estado } : { tipo: "inexistente" };
  }
  const f = await tx.execute<FilaAlarmaApi>(sql`
    SELECT ${COLUMNAS}
    FROM app.alarmas a JOIN app.nodos n ON n.id = a.nodo_id
    WHERE a.id = ${alarmaId}::uuid`);
  const fila = f.rows[0] as FilaAlarmaApi;
  const alarma = aApi(fila, await nombresDeMiembros(tx, fila.espacio_id));
  return {
    tipo: "atendida",
    alarma,
    evento: {
      alarma_id: alarma.id,
      nodo_id: alarma.nodo_id,
      espacio_id: alarma.espacio_id,
      tipo: alarma.tipo,
      severidad: alarma.severidad,
      estado: alarma.estado,
      cambio: "atendida",
      causa: alarma.causa,
      abierta_en: alarma.abierta_en,
      actualizado_en: new Date().toISOString(),
    },
  };
}
