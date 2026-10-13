import type { EstadoNodoEvento } from "@lympha/contracts";
import {
  CONFIANZAS,
  type Confianza,
  canalNuevo,
  type EstadoMotor,
  estadoMotorNuevo,
  type Lectura,
  NIVELES,
  type Nivel,
} from "@lympha/wqi";
import { sql } from "drizzle-orm";
import { type BdApp, type BdSistema, conSistema, conUsuario } from "../../platform/db.ts";
import { evaluaciones } from "./tablas.ts";

/** Lo que el worker escribe en `app.estado_nodo` tras evaluar el último lote de un nodo. */
export interface EstadoParaGuardar {
  nodoId: string;
  espacioId: string;
  ts: number;
  nivel: Nivel;
  wqi: number | null;
  confianza: Confianza;
  parametroLimitante: string | null;
  causa: string;
  accion: string;
  valores: {
    ph: number | null;
    temperatura: number | null;
    conductividad: number | null;
    turbidez: number | null;
    tds: number | null;
  };
}

export interface EvaluacionParaGuardar {
  nodoId: string;
  espacioId: string;
  ts: number;
  wqi: number | null;
  nivel: Nivel;
  parametroLimitante: string | null;
  confianza: Confianza;
  versionAlgoritmo: string;
  subindices: Record<string, number>;
}

/**
 * Escribe evaluaciones y estado en UNA transacción. Es idempotente: una evaluación repetida
 * (mismo nodo y ts) no se duplica y el estado nunca retrocede en el tiempo.
 */
export async function guardarEvaluaciones(
  bd: BdSistema,
  filas: EvaluacionParaGuardar[],
  estados: EstadoParaGuardar[],
): Promise<void> {
  if (filas.length === 0 && estados.length === 0) return;
  await conSistema(bd, async (tx) => {
    for (let i = 0; i < filas.length; i += 500) {
      await tx
        .insert(evaluaciones)
        .values(
          filas.slice(i, i + 500).map((f) => ({
            nodoId: f.nodoId,
            espacioId: f.espacioId,
            ts: new Date(f.ts),
            wqi: f.wqi,
            nivel: f.nivel,
            parametroLimitante: f.parametroLimitante,
            confianza: f.confianza,
            versionAlgoritmo: f.versionAlgoritmo,
            subindices: f.subindices,
          })),
        )
        .onConflictDoNothing({ target: [evaluaciones.nodoId, evaluaciones.ts] });
    }
    for (const e of estados) {
      await tx.execute(sql`
        INSERT INTO app.estado_nodo
          (nodo_id, espacio_id, ultima_lectura_en, nivel, wqi, parametro_limitante, confianza,
           ultimos_valores, causa, accion, actualizado_en)
        VALUES
          (${e.nodoId}::uuid, ${e.espacioId}::uuid, ${new Date(e.ts)}, ${e.nivel}::app.nivel, ${e.wqi},
           ${e.parametroLimitante}, ${e.confianza}::app.confianza, ${JSON.stringify(e.valores)}::jsonb,
           ${e.causa}, ${e.accion}, now())
        ON CONFLICT (nodo_id) DO UPDATE SET
          espacio_id = EXCLUDED.espacio_id,
          ultima_lectura_en = EXCLUDED.ultima_lectura_en,
          nivel = EXCLUDED.nivel,
          wqi = EXCLUDED.wqi,
          parametro_limitante = EXCLUDED.parametro_limitante,
          confianza = EXCLUDED.confianza,
          ultimos_valores = EXCLUDED.ultimos_valores,
          causa = EXCLUDED.causa,
          accion = EXCLUDED.accion,
          actualizado_en = now()
        WHERE app.estado_nodo.ultima_lectura_en IS NULL
           OR app.estado_nodo.ultima_lectura_en <= EXCLUDED.ultima_lectura_en`);
    }
  });
}

const esNivel = (x: unknown): x is Nivel => (NIVELES as readonly unknown[]).includes(x);
const esConfianza = (x: unknown): x is Confianza => (CONFIANZAS as readonly unknown[]).includes(x);

/**
 * Reconstruye el estado del motor desde Postgres cuando Valkey no tiene la memoria del nodo:
 * el nivel y la confianza confirmados salen de `estado_nodo` y la ventana, de las últimas lecturas ya
 * evaluadas (hasta la última fila de `ts.evaluaciones`). La cuenta de un cambio pendiente se pierde (empieza de cero): es la única degradación.
 */
export async function reconstruirEstado(
  bd: BdSistema,
  nodoId: string,
  tamanoVentana: number,
): Promise<EstadoMotor> {
  return conSistema(bd, async (tx) => {
    // Lo ya evaluado se mide con `ts.evaluaciones`, no con `estado_nodo.ultima_lectura_en`: al guardar un lote,
    // telemetría ya adelantó esa columna aunque la evaluación aún no corra (o haya fallado), y tomarla como
    // referencia haría saltarse esas lecturas como si fueran atrasadas.
    const e = await tx.execute<{
      nivel: string;
      confianza: string;
      ultima_evaluada: Date | null;
    }>(sql`
      SELECT e.nivel, e.confianza,
             (SELECT max(ts) FROM ts.evaluaciones WHERE nodo_id = e.nodo_id) AS ultima_evaluada
      FROM app.estado_nodo e WHERE e.nodo_id = ${nodoId}::uuid`);
    const fila = e.rows[0];
    if (!fila || fila.ultima_evaluada === null) return estadoMotorNuevo();

    const ultimo = new Date(fila.ultima_evaluada);
    const l = await tx.execute<{
      ts: Date;
      ph: number | null;
      temperatura: number | null;
      conductividad: number | null;
      turbidez: number | null;
      tds: number | null;
    }>(sql`
      SELECT ts, ph, temperatura, conductividad, turbidez, tds
      FROM ts.lecturas
      WHERE nodo_id = ${nodoId}::uuid AND ts <= ${ultimo}
      ORDER BY ts DESC
      LIMIT ${tamanoVentana}`);
    const ventana: Lectura[] = l.rows
      .map((r) => ({
        ts: new Date(r.ts).getTime(),
        ph: r.ph,
        temperatura: r.temperatura,
        conductividad: r.conductividad,
        turbidez: r.turbidez,
        tds: r.tds,
      }))
      .reverse();

    const nivel = esNivel(fila.nivel) && fila.nivel !== "sin_datos" ? fila.nivel : null;
    return {
      ventana,
      ultimoTs: ultimo.getTime(),
      nivel: canalNuevo<Nivel>(nivel),
      confianza: canalNuevo<Confianza>(esConfianza(fila.confianza) ? fila.confianza : "ok"),
      limitante: null,
    };
  });
}

/**
 * Estado de todos los nodos de un espacio, o `null` si el espacio no existe o no es del usuario
 * (el llamador responde 404 en ambos casos: no se revela si existe). Va por `conUsuario()`, así que
 * la RLS de `estado_nodo` y `espacios` decide qué ve.
 */
export async function estadosDelEspacio(
  bd: BdApp,
  usuarioId: string,
  espacioId: string,
): Promise<EstadoNodoEvento[] | null> {
  return conUsuario(bd, usuarioId, async (tx) => {
    const visible = await tx.execute(sql`SELECT 1 FROM app.espacios WHERE id = ${espacioId}::uuid`);
    if (visible.rows.length === 0) return null;
    const r = await tx.execute<{
      nodo_id: string;
      espacio_id: string;
      nivel: Nivel;
      wqi: string | null;
      confianza: Confianza;
      parametro_limitante: string | null;
      causa: string | null;
      accion: string | null;
      ultima_lectura_en: Date | null;
      ultimos_valores: EstadoNodoEvento["valores"];
      actualizado_en: Date;
    }>(sql`
      SELECT nodo_id, espacio_id, nivel, wqi, confianza, parametro_limitante, causa, accion,
             ultima_lectura_en, ultimos_valores, actualizado_en
      FROM app.estado_nodo
      WHERE espacio_id = ${espacioId}::uuid
      ORDER BY nodo_id`);
    return r.rows.map((f) => ({
      nodo_id: f.nodo_id,
      espacio_id: f.espacio_id,
      nivel: f.nivel,
      wqi: f.wqi === null ? null : Number(f.wqi),
      confianza: f.confianza,
      parametro_limitante: f.parametro_limitante,
      causa: f.causa,
      accion: f.accion,
      ultima_lectura_en: f.ultima_lectura_en ? new Date(f.ultima_lectura_en).toISOString() : null,
      valores: f.ultimos_valores,
      actualizado_en: new Date(f.actualizado_en).toISOString(),
    }));
  });
}
