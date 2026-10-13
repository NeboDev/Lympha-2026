import type {
  CambioAlarma,
  EstadoAlarma,
  EventoAlarma,
  EventoAviso,
  SeveridadAlarma,
  TipoAlarma,
} from "@lympha/contracts";
import type { Confianza, Nivel } from "@lympha/wqi";
import { sql } from "drizzle-orm";
import type { Tx } from "../../platform/db.ts";
import { encolarAvisos } from "../notificaciones/index.ts";
import { nombreNodo, textoAviso } from "./plantillas.ts";
import { decidirNivel, decidirSensor, esAvisable, RANGO_SEVERIDAD } from "./reglas.ts";

/**
 * Ciclo de vida de las alarmas de nivel y de sensor. Se ejecuta DENTRO de la transacción en que el worker
 * escribe `ts.evaluaciones` y `app.estado_nodo`: la alarma y sus avisos quedan o no quedan juntos, y un
 * reintento del lote encuentra la alarma ya abierta y no hace nada (RF-30). No suaviza nada: el nivel que
 * recibe ya pasó por la histéresis de `@lympha/wqi`.
 */

/** Lo que el ciclo necesita del estado confirmado de un nodo (es un subconjunto de lo que escribe `calidad`). */
export interface EstadoConfirmado {
  nodoId: string;
  espacioId: string;
  /** Hora de la evaluación (ms Unix, hora del nodo). */
  ts: number;
  nivel: Nivel;
  wqi: number | null;
  confianza: Confianza;
  parametroLimitante: string | null;
  causa: string;
  accion: string;
  valores: unknown;
}

export interface ResultadoCiclo {
  /** Cambios para el stream SSE; se publican después de confirmar la transacción. */
  eventos: EventoAlarma[];
  /** Filas nuevas en la bandeja de salida. */
  avisos: number;
}

interface FilaAlarma extends Record<string, unknown> {
  id: string;
  tipo: TipoAlarma;
  severidad: string;
  estado: EstadoAlarma;
  abierta_en: Date;
  detalle: Record<string, unknown> | null;
}

const esSeveridad = (s: string): s is SeveridadAlarma =>
  s === "regular" || s === "mala" || s === "critica";

export async function aplicarCiclo(
  tx: Tx,
  estados: readonly EstadoConfirmado[],
  ahoraMs: number = Date.now(),
): Promise<ResultadoCiclo> {
  const eventos: EventoAlarma[] = [];
  let avisos = 0;
  const ahora = new Date(ahoraMs).toISOString();

  for (const e of estados) {
    // Las alarmas abiertas del nodo, bloqueadas: nadie más las cambia mientras decidimos.
    const abiertas = (
      await tx.execute<FilaAlarma>(sql`
        SELECT id, tipo, severidad, estado, abierta_en, detalle
        FROM app.alarmas
        WHERE nodo_id = ${e.nodoId}::uuid AND tipo IN ('nivel', 'sensor') AND estado <> 'resuelta'
        FOR UPDATE`)
    ).rows;
    const deNivel = abiertas.find((f) => f.tipo === "nivel");
    const deSensor = abiertas.find((f) => f.tipo === "sensor");

    let nombres: { nodo: string; espacio: string } | undefined;
    const cargarNombres = async () => {
      if (nombres) return nombres;
      const r = await tx.execute<{ nodo: string | null; espacio: string }>(sql`
        SELECT n.nombre AS nodo, es.nombre AS espacio
        FROM app.nodos n, app.espacios es
        WHERE n.id = ${e.nodoId}::uuid AND es.id = ${e.espacioId}::uuid`);
      const f = r.rows[0];
      nombres = {
        nodo: nombreNodo(f?.nodo ?? null, e.nodoId),
        espacio: f?.espacio ?? "tu espacio",
      };
      return nombres;
    };

    const publicar = (
      alarma: { id: string; tipo: TipoAlarma; abiertaEn: Date },
      severidad: SeveridadAlarma,
      estado: EstadoAlarma,
      cambio: CambioAlarma,
    ) => {
      eventos.push({
        alarma_id: alarma.id,
        nodo_id: e.nodoId,
        espacio_id: e.espacioId,
        tipo: alarma.tipo,
        severidad,
        estado,
        cambio,
        causa: e.causa,
        abierta_en: new Date(alarma.abiertaEn).toISOString(),
        actualizado_en: ahora,
      });
    };

    const avisar = async (a: {
      alarmaId: string;
      tipo: TipoAlarma;
      evento: EventoAviso;
      severidad?: SeveridadAlarma;
      anterior?: SeveridadAlarma;
      niveles: readonly SeveridadAlarma[] | null;
      incluirPrevios: boolean;
    }) => {
      // Un lote recuperado de hace horas actualiza el estado pero no avisa de algo que ya pasó.
      if (!esAvisable(e.ts, ahoraMs)) return;
      const n = await cargarNombres();
      avisos += await encolarAvisos(tx, {
        espacioId: e.espacioId,
        nodoId: e.nodoId,
        alarmaId: a.alarmaId,
        evento: a.evento,
        clave: e.ts,
        niveles: a.niveles,
        incluirPrevios: a.incluirPrevios,
        payload: {
          texto: textoAviso({
            evento: a.evento,
            tipo: a.tipo,
            nodo: n.nodo,
            espacio: n.espacio,
            severidad: a.severidad,
            anterior: a.anterior,
            causa: e.causa,
            accion: e.accion,
          }),
          tipo: a.tipo,
          evento: a.evento,
          nodo_id: e.nodoId,
          severidad: a.severidad ?? null,
          anterior: a.anterior ?? null,
        },
      });
    };

    const detalleActual = JSON.stringify({
      ts: new Date(e.ts).toISOString(),
      wqi: e.wqi,
      parametro_limitante: e.parametroLimitante,
      accion: e.accion,
      valores: e.valores,
    });

    // ── Alarma de nivel ─────────────────────────────────────────────────────────────────────────────
    const severidadAbierta = deNivel && esSeveridad(deNivel.severidad) ? deNivel.severidad : null;
    const accion = decidirNivel(severidadAbierta, e.nivel);

    if (accion.tipo === "abrir") {
      const r = await tx.execute<{ id: string; abierta_en: Date }>(sql`
        INSERT INTO app.alarmas (nodo_id, espacio_id, tipo, severidad, causa, detalle)
        VALUES (${e.nodoId}::uuid, ${e.espacioId}::uuid, 'nivel', ${accion.severidad}::app.nivel, ${e.causa},
                jsonb_build_object('pico', ${accion.severidad}::text, 'apertura', ${detalleActual}::jsonb))
        ON CONFLICT (nodo_id, tipo) WHERE estado <> 'resuelta' DO NOTHING
        RETURNING id, abierta_en`);
      const nueva = r.rows[0];
      if (nueva) {
        publicar(
          { id: nueva.id, tipo: "nivel", abiertaEn: nueva.abierta_en },
          accion.severidad,
          "activa",
          "abierta",
        );
        await avisar({
          alarmaId: nueva.id,
          tipo: "nivel",
          evento: "abierta",
          severidad: accion.severidad,
          niveles: [accion.severidad],
          incluirPrevios: false,
        });
      }
    } else if (deNivel && (accion.tipo === "escalar" || accion.tipo === "mejorar")) {
      const escalar = accion.tipo === "escalar";
      const picoPrevio = deNivel.detalle?.pico;
      const pico =
        typeof picoPrevio === "string" &&
        esSeveridad(picoPrevio) &&
        RANGO_SEVERIDAD[picoPrevio] > RANGO_SEVERIDAD[accion.severidad]
          ? picoPrevio
          : accion.severidad;
      // Un empeoramiento reabre la alarma que alguien ya había atendido: esa atención no cubría esto.
      const r = await tx.execute<{ estado: EstadoAlarma }>(sql`
        UPDATE app.alarmas SET
          severidad   = ${accion.severidad}::app.nivel,
          escalada_en = CASE WHEN ${escalar} THEN now() ELSE escalada_en END,
          causa       = ${e.causa},
          estado      = CASE WHEN ${escalar} THEN 'activa'::app.alarma_estado ELSE estado END,
          atendida_por = CASE WHEN ${escalar} THEN NULL ELSE atendida_por END,
          atendida_en  = CASE WHEN ${escalar} THEN NULL ELSE atendida_en END,
          detalle = detalle || jsonb_build_object('pico', ${pico}::text, 'ultimo', ${detalleActual}::jsonb)
                    || CASE WHEN ${escalar} AND estado = 'atendida'
                            THEN jsonb_build_object('atencion_previa',
                                   jsonb_build_object('por', atendida_por, 'en', atendida_en))
                            ELSE '{}'::jsonb END
        WHERE id = ${deNivel.id}::uuid
        RETURNING estado`);
      publicar(
        { id: deNivel.id, tipo: "nivel", abiertaEn: deNivel.abierta_en },
        accion.severidad,
        r.rows[0]?.estado ?? "activa",
        escalar ? "escalada" : "mejorada",
      );
      await avisar({
        alarmaId: deNivel.id,
        tipo: "nivel",
        evento: escalar ? "escalada" : "mejorada",
        severidad: accion.severidad,
        anterior: accion.anterior,
        niveles: escalar ? [accion.severidad] : [accion.severidad, accion.anterior],
        // Una mejora intermedia solo interesa a quien sigue los niveles implicados; el cierre, a todo el que ya fue avisado.
        incluirPrevios: false,
      });
    } else if (deNivel && accion.tipo === "resolver") {
      await tx.execute(sql`
        UPDATE app.alarmas SET estado = 'resuelta', resuelta_en = now(),
               detalle = detalle || jsonb_build_object('resolucion', ${detalleActual}::jsonb)
        WHERE id = ${deNivel.id}::uuid`);
      publicar(
        { id: deNivel.id, tipo: "nivel", abiertaEn: deNivel.abierta_en },
        accion.anterior,
        "resuelta",
        "resuelta",
      );
      await avisar({
        alarmaId: deNivel.id,
        tipo: "nivel",
        evento: "resuelta",
        anterior: accion.anterior,
        niveles: [accion.anterior],
        incluirPrevios: true,
      });
    }

    // ── Alarma de sensor (RF-39) ────────────────────────────────────────────────────────────────────
    const accionSensor = decidirSensor(deSensor !== undefined, e.confianza);
    if (accionSensor === "abrir") {
      const r = await tx.execute<{ id: string; abierta_en: Date }>(sql`
        INSERT INTO app.alarmas (nodo_id, espacio_id, tipo, severidad, causa, detalle)
        VALUES (${e.nodoId}::uuid, ${e.espacioId}::uuid, 'sensor', 'regular', ${e.causa},
                jsonb_build_object('apertura', ${detalleActual}::jsonb))
        ON CONFLICT (nodo_id, tipo) WHERE estado <> 'resuelta' DO NOTHING
        RETURNING id, abierta_en`);
      const nueva = r.rows[0];
      if (nueva) {
        publicar(
          { id: nueva.id, tipo: "sensor", abiertaEn: nueva.abierta_en },
          "regular",
          "activa",
          "abierta",
        );
        await avisar({
          alarmaId: nueva.id,
          tipo: "sensor",
          evento: "abierta",
          severidad: "regular",
          niveles: null,
          incluirPrevios: false,
        });
      }
    } else if (deSensor && accionSensor === "resolver") {
      await tx.execute(sql`
        UPDATE app.alarmas SET estado = 'resuelta', resuelta_en = now(),
               detalle = detalle || jsonb_build_object('resolucion', ${detalleActual}::jsonb)
        WHERE id = ${deSensor.id}::uuid`);
      publicar(
        { id: deSensor.id, tipo: "sensor", abiertaEn: deSensor.abierta_en },
        "regular",
        "resuelta",
        "resuelta",
      );
      await avisar({
        alarmaId: deSensor.id,
        tipo: "sensor",
        evento: "resuelta",
        severidad: "regular",
        niveles: null,
        incluirPrevios: false,
      });
    }
  }

  return { eventos, avisos };
}
