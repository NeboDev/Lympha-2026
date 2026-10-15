import { type Job, UnrecoverableError, Worker } from "bullmq";
import type { BdSistema } from "../../platform/db.ts";
import type { Logger } from "../../platform/logger.ts";
import { COLA_LECTURAS } from "../../platform/queues.ts";
import type { Redis } from "../../platform/valkey.ts";
import { aplicarEvento } from "./eventos.ts";
import { guardarLecturas, type ResultadoGuardado } from "./guardar.ts";
import {
  type EventoNodo,
  eventoNodo,
  type LecturaTrabajo,
  TRABAJO_EVENTO,
  type TrabajoLecturas,
  trabajoLecturas,
} from "./schema.ts";

/**
 * Consumidor de la cola `lecturas` con agrupación manual (BullMQ sin Pro): toma trabajos hasta
 * `maximo` lecturas o hasta que pasen `ventanaMs` desde el primero, los guarda en un solo INSERT
 * ordenado por (nodo_id, ts) y recién entonces los completa. Concurrencia 1: un lote a la vez,
 * para no romper la histéresis que H2 calcula sobre lecturas ordenadas.
 *
 * Si el proceso cae a mitad de un lote, los trabajos quedan activos sin completar; el chequeo de
 * trabajos estancados de BullMQ los devuelve a la cola y la idempotencia de la base evita duplicados.
 */

export interface OpcionesConsumidor {
  conexion: Redis;
  bd: BdSistema;
  log: Logger;
  ventanaMs?: number;
  maximo?: number;
  /** Tiempo tras el cual un trabajo sin completar se considera estancado. */
  lockDurationMs?: number;
  stalledIntervalMs?: number;
  /** Para métricas: se llama tras guardar cada lote. */
  alGuardar?: (resultado: ResultadoGuardado, eventos: number) => void;
  /**
   * Se ejecuta tras guardar cada lote (p. ej. la evaluación del WQI). Si lanza, el lote se reintenta:
   * guardar es idempotente, así que quien se enganche aquí también debe serlo.
   */
  alEvaluar?: (filas: LecturaTrabajo[]) => Promise<void>;
  /**
   * Un nodo pasó de desconectado a conectado (cambio real, no un evento repetido). Va después de aplicar el
   * evento y NO debe lanzar: si falla, el barrido de mantenimiento cierra la alarma de desconexión de todos modos.
   */
  alReconectar?: (nodoId: string) => Promise<void>;
  /**
   * La conexión de un nodo cambió de verdad (cae o vuelve; no un evento repetido ni uno viejo). Es para avisar a
   * la PWA por el stream del espacio. NO debe lanzar: es una notificación, no parte de guardar el lote.
   */
  alCambiarConexion?: (cambio: {
    nodoId: string;
    espacioId: string;
    conectado: boolean;
    en: Date;
  }) => void | Promise<void>;
}

export interface Consumidor {
  detener(): Promise<void>;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function iniciarConsumidor(op: OpcionesConsumidor): Promise<Consumidor> {
  const ventanaMs = op.ventanaMs ?? 200;
  const maximo = op.maximo ?? 500;
  const token = `consumidor-${process.pid}-${Date.now()}`;

  const worker = new Worker<TrabajoLecturas>(COLA_LECTURAS, null, {
    connection: op.conexion,
    autorun: false,
    lockDuration: op.lockDurationMs ?? 30_000,
    stalledInterval: op.stalledIntervalMs ?? 30_000,
    maxStalledCount: 5,
  });
  worker.on("error", (e) => op.log.error({ err: e }, "error de BullMQ"));
  await worker.startStalledCheckTimer();

  let activo = true;

  async function leerLote(): Promise<{
    trabajos: Job<TrabajoLecturas>[];
    filas: LecturaTrabajo[];
    eventos: EventoNodo[];
  }> {
    const trabajos: Job<TrabajoLecturas>[] = [];
    const filas: LecturaTrabajo[] = [];
    const eventos: EventoNodo[] = [];

    const aceptar = async (job: Job<TrabajoLecturas>): Promise<void> => {
      if (job.name === TRABAJO_EVENTO) {
        const e = eventoNodo.safeParse(job.data);
        if (!e.success) {
          op.log.error({ jobId: job.id }, "evento de nodo con formato inválido; se descarta");
          await job.moveToFailed(new UnrecoverableError("formato inválido"), token, false);
          return;
        }
        trabajos.push(job);
        eventos.push(e.data);
        return;
      }
      const v = trabajoLecturas.safeParse(job.data);
      if (!v.success) {
        op.log.error({ jobId: job.id }, "trabajo de lecturas con formato inválido; se descarta");
        await job.moveToFailed(new UnrecoverableError("formato inválido"), token, false);
        return;
      }
      trabajos.push(job);
      filas.push(...v.data.lecturas);
    };

    // El primero espera (bloqueando) a que haya trabajo; el resto, solo mientras dure la ventana.
    const primero = await worker.getNextJob(token, { block: true });
    if (!primero) return { trabajos, filas, eventos };
    await aceptar(primero);

    const limite = Date.now() + ventanaMs;
    while (activo && filas.length + eventos.length < maximo && Date.now() < limite) {
      const job = await worker.getNextJob(token, { block: false });
      if (job) {
        await aceptar(job);
      } else {
        await dormir(Math.min(15, Math.max(0, limite - Date.now())));
      }
    }
    return { trabajos, filas, eventos };
  }

  const bucle = (async () => {
    while (activo) {
      let lote: Awaited<ReturnType<typeof leerLote>>;
      try {
        lote = await leerLote();
      } catch (error) {
        if (!activo) break;
        op.log.error({ err: error }, "no se pudo leer la cola; se reintenta");
        await dormir(1000);
        continue;
      }
      if (lote.trabajos.length === 0) continue;

      try {
        const r = await guardarLecturas(op.bd, lote.filas);
        const reconectados: string[] = [];
        for (const evento of lote.eventos) {
          const cambio = await aplicarEvento(op.bd, evento);
          if (cambio === "conectado") reconectados.push(evento.nodoId);
          if (cambio !== null && evento.tipo === "estado") {
            await Promise.resolve(
              op.alCambiarConexion?.({
                nodoId: evento.nodoId,
                espacioId: evento.espacioId,
                conectado: cambio === "conectado",
                en: new Date(evento.recibidoEn),
              }),
            ).catch((e: unknown) =>
              op.log.warn({ err: e }, "no se pudo avisar el cambio de conexión"),
            );
          }
        }
        for (const nodoId of reconectados) await op.alReconectar?.(nodoId);
        await op.alEvaluar?.(lote.filas);
        op.alGuardar?.(r, lote.eventos.length);
        op.log.debug(
          { ...r, eventos: lote.eventos.length, trabajos: lote.trabajos.length },
          "lote guardado",
        );
        for (const job of lote.trabajos) await job.moveToCompleted(r, token, false);
      } catch (error) {
        op.log.error({ err: error, trabajos: lote.trabajos.length }, "no se pudo guardar el lote");
        for (const job of lote.trabajos) {
          await job.moveToFailed(error as Error, token, false).catch((e: unknown) => {
            op.log.error({ err: e }, "no se pudo marcar el trabajo como fallido");
          });
        }
        await dormir(500);
      }
    }
  })();

  return {
    async detener() {
      activo = false;
      await worker.close();
      await bucle.catch(() => undefined);
    },
  };
}
