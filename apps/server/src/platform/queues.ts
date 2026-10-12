import { type DefaultJobOptions, Queue } from "bullmq";
import type { Redis } from "./valkey.ts";

/** Colas de BullMQ. Los avisos NO usan cola: salen de app.notificaciones_salida (outbox en Postgres). */
export const COLA_LECTURAS = "lecturas";
export const COLA_MANTENIMIENTO = "mantenimiento";

/**
 * Sin `jobId`: BullMQ rechaza ":" en ids personalizados y un reenvío del broker produce un trabajo
 * distinto de todos modos. La idempotencia está en la base: ON CONFLICT (nodo_id, ts) DO NOTHING.
 */
export const OPCIONES_TRABAJO: DefaultJobOptions = {
  attempts: 8,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: { age: 3600, count: 5000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

export function crearCola<T>(nombre: string, conexion: Redis): Queue<T> {
  return new Queue<T>(nombre, { connection: conexion, defaultJobOptions: OPCIONES_TRABAJO });
}
