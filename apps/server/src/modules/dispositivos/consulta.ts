import type { NodoApi } from "@lympha/contracts";
import { type SQL, sql } from "drizzle-orm";
import type { Tx } from "../../platform/db.ts";

type FilaNodo = {
  id: string;
  espacio_id: string | null;
  nombre: string | null;
  perfil_id: string;
  estado: NodoApi["estado"];
  version_fw: string | null;
  reclamado_en: Date | null;
  conectado: boolean | null;
  cambio_conexion_en: Date | null;
  ultima_lectura_en: Date | null;
  nivel: NonNullable<NodoApi["estado_actual"]>["nivel"] | null;
  wqi: string | null;
  parametro_limitante: string | null;
  confianza: NonNullable<NodoApi["estado_actual"]>["confianza"] | null;
  ultimos_valores: Record<string, unknown> | null;
};

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

/**
 * Nodos visibles para el usuario de la transacción (RLS) con su último estado conocido. `donde` filtra por
 * nodo o por espacio; el aislamiento no depende de él.
 */
export async function consultarNodos(tx: Tx, donde: SQL): Promise<NodoApi[]> {
  const r = await tx.execute<FilaNodo>(sql`
    SELECT n.id, n.espacio_id, n.nombre, n.perfil_id, n.estado, n.version_fw, n.reclamado_en,
           e.conectado, e.cambio_conexion_en, e.ultima_lectura_en, e.nivel, e.wqi,
           e.parametro_limitante, e.confianza, e.ultimos_valores
    FROM app.nodos n
    LEFT JOIN app.estado_nodo e ON e.nodo_id = n.id
    WHERE ${donde}
    ORDER BY n.creado_en, n.id`);
  return r.rows.map((f) => ({
    id: f.id,
    espacio_id: f.espacio_id,
    nombre: f.nombre,
    perfil_id: f.perfil_id,
    estado: f.estado,
    version_fw: f.version_fw,
    reclamado_en: iso(f.reclamado_en),
    estado_actual:
      f.nivel === null || f.confianza === null
        ? null
        : {
            conectado: f.conectado ?? false,
            cambio_conexion_en: iso(f.cambio_conexion_en),
            ultima_lectura_en: iso(f.ultima_lectura_en),
            nivel: f.nivel,
            wqi: f.wqi === null ? null : Number(f.wqi),
            parametro_limitante: f.parametro_limitante,
            confianza: f.confianza,
            ultimos_valores: f.ultimos_valores,
          },
  }));
}
