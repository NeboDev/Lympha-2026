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
  causa: string | null;
  accion: string | null;
  confianza: NonNullable<NodoApi["estado_actual"]>["confianza"] | null;
  ultimos_valores: Record<string, unknown> | null;
  cal_ultima: Date | null;
  cal_estado: NonNullable<NodoApi["calibracion"]>["estado"];
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
           e.parametro_limitante, e.confianza, e.causa, e.accion, e.ultimos_valores,
           cal.ultima AS cal_ultima,
           CASE WHEN cal.mas_antigua IS NULL THEN 'sin_calibrar'
                WHEN cal.mas_antigua < now() - make_interval(days => coalesce(p.calibracion_vence_dias, 90))
                  THEN 'vencida'
                ELSE 'vigente' END AS cal_estado
    FROM app.nodos n
    LEFT JOIN app.estado_nodo e ON e.nodo_id = n.id
    LEFT JOIN app.perfiles_uso p ON p.id = n.perfil_id
    -- calibraciones guiadas vigentes: la más reciente es «la última»; la más antigua decide si ya venció
    LEFT JOIN LATERAL (
      SELECT max(c.creado_en) AS ultima, min(c.creado_en) AS mas_antigua
      FROM app.calibraciones_sensor c
      WHERE c.nodo_id = n.id AND c.activa AND c.origen = 'guiada'
    ) cal ON true
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
    calibracion: { ultima_en: iso(f.cal_ultima), estado: f.cal_estado },
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
            causa: f.causa,
            accion: f.accion,
            ultimos_valores: f.ultimos_valores,
          },
  }));
}
