import {
  type ConteoNiveles,
  type DiaHistorial,
  type RespuestaHistorial,
  ZONA_HISTORIAL,
} from "@lympha/contracts";
import { sql } from "drizzle-orm";
import { type BdApp, conUsuario } from "../../platform/db.ts";

type NivelDia = DiaHistorial["nivel"];

/** De peor a mejor: en un empate gana el peor (es más caro callar un problema que avisarlo de más). */
const DE_PEOR_A_MEJOR = ["critica", "mala", "regular", "buena"] as const;

/**
 * Nivel predominante del día (RF-35): el más frecuente entre las evaluaciones con dato; en empate, el peor.
 * Las evaluaciones `sin_datos` no cuentan, salvo que sean las únicas del día.
 */
export function nivelPredominante(c: ConteoNiveles): NivelDia {
  let ganador: NivelDia = "sin_datos";
  let mayor = 0;
  for (const nivel of DE_PEOR_A_MEJOR) {
    if (c[nivel] > mayor) {
      ganador = nivel;
      mayor = c[nivel];
    }
  }
  return ganador;
}

type FilaHistorial = {
  dia: string;
  n_buena: number | null;
  n_regular: number | null;
  n_mala: number | null;
  n_critica: number | null;
  n_sin_datos: number | null;
  wqi_prom: number | null;
  wqi_min: number | null;
  lecturas: number | null;
  ph: number | null;
  temperatura: number | null;
  conductividad: number | null;
  turbidez: number | null;
  turbidez_max: number | null;
  tds: number | null;
};

/**
 * Historial diario de un nodo del usuario (últimos `dias` días calendario de México, contando hoy), o `null` si
 * el nodo no existe o no es de sus espacios (el llamador responde 404 en ambos casos: RNF-01). Se lee SOLO por
 * `app.v_evaluaciones_dia` y `app.v_lecturas_dia`, los agregados continuos (con datos en tiempo real para hoy).
 */
export async function historialDelNodo(
  bd: BdApp,
  usuarioId: string,
  nodoId: string,
  dias: 7 | 30,
): Promise<RespuestaHistorial | null> {
  return conUsuario(bd, usuarioId, async (tx) => {
    const visible = await tx.execute(sql`SELECT 1 FROM app.nodos WHERE id = ${nodoId}`);
    if (visible.rows.length === 0) return null;

    const r = await tx.execute<FilaHistorial>(sql`
      WITH limite AS (
        SELECT (((now() AT TIME ZONE ${ZONA_HISTORIAL})::date - ${dias - 1}::int)::timestamp
                AT TIME ZONE ${ZONA_HISTORIAL}) AS desde
      ),
      ev AS (
        SELECT dia, n_buena, n_regular, n_mala, n_critica, n_sin_datos, wqi_prom, wqi_min
        FROM app.v_evaluaciones_dia, limite
        WHERE nodo_id = ${nodoId} AND dia >= limite.desde
      ),
      lec AS (
        SELECT dia, n, ph_prom, t_prom, ec_prom, turb_prom, turb_max, tds_prom
        FROM app.v_lecturas_dia, limite
        WHERE nodo_id = ${nodoId} AND dia >= limite.desde
      )
      SELECT to_char(COALESCE(ev.dia, lec.dia) AT TIME ZONE ${ZONA_HISTORIAL}, 'YYYY-MM-DD') AS dia,
             ev.n_buena::int, ev.n_regular::int, ev.n_mala::int, ev.n_critica::int, ev.n_sin_datos::int,
             ev.wqi_prom::float8 AS wqi_prom, ev.wqi_min::float8 AS wqi_min,
             lec.n::int AS lecturas,
             lec.ph_prom::float8 AS ph, lec.t_prom::float8 AS temperatura, lec.ec_prom::float8 AS conductividad,
             lec.turb_prom::float8 AS turbidez, lec.turb_max::float8 AS turbidez_max, lec.tds_prom::float8 AS tds
      FROM ev FULL OUTER JOIN lec ON lec.dia = ev.dia
      ORDER BY 1`);

    return {
      nodo_id: nodoId,
      dias,
      zona: ZONA_HISTORIAL,
      historial: r.rows.map((f) => {
        const evaluaciones: ConteoNiveles = {
          buena: f.n_buena ?? 0,
          regular: f.n_regular ?? 0,
          mala: f.n_mala ?? 0,
          critica: f.n_critica ?? 0,
          sin_datos: f.n_sin_datos ?? 0,
        };
        return {
          dia: f.dia,
          nivel: nivelPredominante(evaluaciones),
          evaluaciones,
          wqi_prom: f.wqi_prom,
          wqi_min: f.wqi_min,
          promedios:
            f.lecturas === null
              ? null
              : {
                  ph: f.ph,
                  temperatura: f.temperatura,
                  conductividad: f.conductividad,
                  turbidez: f.turbidez,
                  turbidez_max: f.turbidez_max,
                  tds: f.tds,
                  lecturas: f.lecturas,
                },
        };
      }),
    };
  });
}
