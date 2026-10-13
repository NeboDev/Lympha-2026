import { canalEspacio, type EstadoNodoEvento } from "@lympha/contracts";
import {
  type EstadoMotor,
  type Lectura,
  obtenerPerfil,
  procesarLectura,
  type Resultado,
} from "@lympha/wqi";
import type { BdSistema } from "../../platform/db.ts";
import type { Logger } from "../../platform/logger.ts";
import type { Redis } from "../../platform/valkey.ts";
import type { ResolvedorNodo } from "../dispositivos/index.ts";
import type { LecturaTrabajo } from "../telemetria/index.ts";
import { guardarMemoria, leerMemoria, type MemoriaNodo } from "./memoria.ts";
import {
  type EstadoParaGuardar,
  type EvaluacionParaGuardar,
  guardarEvaluaciones,
  reconstruirEstado,
} from "./repo.ts";

/**
 * Evaluador del worker: por cada lote de lecturas ya guardadas, corre el motor WQI por nodo
 * (ventana móvil + histéresis), escribe `ts.evaluaciones` y `app.estado_nodo` en una transacción,
 * actualiza la memoria en Valkey y publica el cambio por `espacio:{id}` para el SSE.
 *
 * Orden de escritura, pensado para reintentos: primero Postgres (fuente de verdad), después la memoria
 * de Valkey y al final la publicación. Si algo falla a la mitad, el reintento del lote recalcula lo
 * mismo desde la memoria anterior: las evaluaciones repetidas son un no-op y las lecturas ya vistas se
 * ignoran por su `ts`.
 */

export interface Evaluador {
  /** Evalúa lecturas ya guardadas. Lanza si falla una dependencia (el lote se reintenta). */
  procesar(filas: LecturaTrabajo[]): Promise<void>;
}

export interface OpcionesEvaluador {
  bd: BdSistema;
  valkey: Redis;
  resolver: ResolvedorNodo;
  log: Logger;
}

interface PorNodo {
  nodoId: string;
  espacioId: string;
  memoria: MemoriaNodo;
  evaluaciones: EvaluacionParaGuardar[];
  ultimo: { resultado: Resultado; lectura: Lectura } | null;
}

const aLectura = (l: LecturaTrabajo): Lectura => ({
  ts: l.ts,
  ph: l.ph,
  temperatura: l.temperatura,
  conductividad: l.conductividad,
  turbidez: l.turbidez,
  tds: l.tds,
});

export function crearEvaluador(op: OpcionesEvaluador): Evaluador {
  const { bd, valkey, resolver, log } = op;

  async function cargarMemoria(
    nodoId: string,
    espacioId: string,
    version: string,
    tamano: number,
  ): Promise<MemoriaNodo> {
    const guardada = await leerMemoria(valkey, nodoId, espacioId, version);
    if (guardada) return guardada;
    const motor: EstadoMotor = await reconstruirEstado(bd, nodoId, tamano);
    return { espacioId, version, motor };
  }

  return {
    async procesar(filas) {
      // Lecturas por nodo, en el orden en que el nodo las midió.
      const porNodo = new Map<string, LecturaTrabajo[]>();
      for (const f of filas) {
        const lista = porNodo.get(f.nodoId);
        if (lista) lista.push(f);
        else porNodo.set(f.nodoId, [f]);
      }

      const trabajo: PorNodo[] = [];
      for (const [nodoId, lecturas] of porNodo) {
        const ordenadas = [...lecturas].sort((a, b) => a.ts - b.ts || a.seq - b.seq);
        const espacioId = (ordenadas.at(-1) as LecturaTrabajo).espacioId;
        // Entrada/salida primero: si Valkey o Postgres fallan, el error sube y el lote se reintenta.
        const meta = await resolver.resolver(nodoId);
        const perfil = meta ? obtenerPerfil(meta.perfilId) : undefined;
        if (!meta || !perfil) {
          log.debug({ nodoId, perfil: meta?.perfilId }, "perfil sin curvas del WQI: no se evalúa");
          continue;
        }
        const memoria = await cargarMemoria(
          nodoId,
          espacioId,
          perfil.version,
          perfil.ventana.tamano,
        );

        // El cálculo es puro: un error aquí es un defecto, y no debe frenar a los demás nodos.
        try {
          const nodo: PorNodo = { nodoId, espacioId, memoria, evaluaciones: [], ultimo: null };
          let motor = memoria.motor;
          for (const fila of ordenadas) {
            const lectura = aLectura(fila);
            const p = procesarLectura(perfil, motor, lectura);
            motor = p.estado;
            if (!p.resultado) continue;
            const r = p.resultado;
            nodo.evaluaciones.push({
              nodoId,
              espacioId: fila.espacioId,
              ts: r.ts,
              wqi: r.wqi,
              nivel: r.nivel,
              parametroLimitante: r.parametroLimitante,
              confianza: r.confianza,
              versionAlgoritmo: r.version,
              subindices: r.subindices as Record<string, number>,
            });
            nodo.ultimo = { resultado: r, lectura };
          }
          nodo.memoria = { espacioId, version: perfil.version, motor };
          if (nodo.ultimo) trabajo.push(nodo);
        } catch (error) {
          log.error({ err: error, nodoId }, "no se pudo evaluar el nodo; se omite en este lote");
        }
      }

      const evaluacionesLote = trabajo.flatMap((n) => n.evaluaciones);
      const estados: EstadoParaGuardar[] = trabajo.flatMap((n) =>
        n.ultimo ? [aEstado(n.nodoId, n.espacioId, n.ultimo.resultado, n.ultimo.lectura)] : [],
      );
      // Nada nuevo (lecturas repetidas o nodos sin perfil): no hay qué escribir.
      if (trabajo.length === 0) return;

      await guardarEvaluaciones(bd, evaluacionesLote, estados);
      for (const n of trabajo) await guardarMemoria(valkey, n.nodoId, n.memoria);

      const ahora = new Date().toISOString();
      for (const n of trabajo) {
        if (!n.ultimo) continue;
        const evento = aEvento(
          aEstado(n.nodoId, n.espacioId, n.ultimo.resultado, n.ultimo.lectura),
          ahora,
        );
        // La publicación es de mejor esfuerzo: el SSE se reconcilia con el snapshot al reconectar.
        await valkey
          .publish(canalEspacio(n.espacioId), JSON.stringify(evento))
          .catch((e: unknown) => {
            log.warn({ err: e, nodoId: n.nodoId }, "no se pudo publicar el estado");
          });
      }
      log.debug({ nodos: trabajo.length, evaluaciones: evaluacionesLote.length }, "lote evaluado");
    },
  };
}

function aEstado(nodoId: string, espacioId: string, r: Resultado, l: Lectura): EstadoParaGuardar {
  return {
    nodoId,
    espacioId,
    ts: r.ts,
    nivel: r.nivel,
    wqi: r.wqi,
    confianza: r.confianza,
    parametroLimitante: r.parametroLimitante,
    causa: r.frase.causa,
    accion: r.frase.accion,
    valores: {
      ph: l.ph,
      temperatura: l.temperatura,
      conductividad: l.conductividad,
      turbidez: l.turbidez,
      tds: l.tds,
    },
  };
}

function aEvento(e: EstadoParaGuardar, ahora: string): EstadoNodoEvento {
  return {
    nodo_id: e.nodoId,
    espacio_id: e.espacioId,
    nivel: e.nivel,
    wqi: e.wqi,
    confianza: e.confianza,
    parametro_limitante: e.parametroLimitante,
    causa: e.causa,
    accion: e.accion,
    ultima_lectura_en: new Date(e.ts).toISOString(),
    valores: e.valores,
    actualizado_en: ahora,
  };
}
