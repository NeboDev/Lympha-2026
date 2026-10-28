import { advertencias } from "@lympha/calibracion";
import type { CalibracionApi } from "@lympha/contracts";
import { sql } from "drizzle-orm";
import type { Tx } from "../../platform/db.ts";

type Fila = {
  id: string;
  nodo_id: string;
  espacio_id: string;
  parametro: CalibracionApi["parametro"];
  pendiente: number;
  desfase: number;
  r2: number | null;
  puntos: CalibracionApi["puntos"];
  origen: CalibracionApi["origen"];
  activa: boolean;
  creado_por: string | null;
  creado_en: Date;
};

const COLUMNAS = sql`id, nodo_id, espacio_id, parametro, pendiente, desfase, r2, puntos, origen, activa, creado_por, creado_en`;

export function aApi(f: Fila): CalibracionApi {
  return {
    id: f.id,
    nodo_id: f.nodo_id,
    espacio_id: f.espacio_id,
    parametro: f.parametro,
    pendiente: f.pendiente,
    desfase: f.desfase,
    r2: f.r2,
    puntos: f.puntos,
    origen: f.origen,
    activa: f.activa,
    creado_por: f.creado_por,
    creado_en: new Date(f.creado_en).toISOString(),
    advertencias:
      f.origen === "guiada" && f.r2 !== null
        ? advertencias({
            pendiente: f.pendiente,
            desfase: f.desfase,
            r2: f.r2,
            puntos: f.puntos.length,
          })
        : [],
  };
}

/** Historial de calibraciones de un nodo (la más reciente primero), visible según la RLS del usuario. */
export async function listarCalibraciones(
  tx: Tx,
  nodoId: string,
  parametro: string | undefined,
  limite: number,
): Promise<CalibracionApi[]> {
  const r = await tx.execute<Fila>(sql`
    SELECT ${COLUMNAS} FROM app.calibraciones_sensor
    WHERE nodo_id = ${nodoId} ${parametro ? sql`AND parametro = ${parametro}` : sql``}
    ORDER BY creado_en DESC, id DESC
    LIMIT ${limite}`);
  return r.rows.map(aApi);
}

export async function calibracionPorId(tx: Tx, id: string): Promise<CalibracionApi | null> {
  const r = await tx.execute<Fila>(
    sql`SELECT ${COLUMNAS} FROM app.calibraciones_sensor WHERE id = ${id}`,
  );
  return r.rows[0] ? aApi(r.rows[0]) : null;
}
