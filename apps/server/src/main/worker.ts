import { iniciarConsumidor } from "../modules/telemetria/index.ts";
import { type ConfigDe, cargarConfigOSalir } from "../platform/config.ts";
import { crearBdSistema } from "../platform/db.ts";
import { crearLogger, type Logger } from "../platform/logger.ts";
import { alApagar } from "../platform/proceso.ts";
import { crearConexionBullmq } from "../platform/valkey.ts";

export interface ProcesoWorker {
  detener(): Promise<void>;
}

export async function iniciarWorker(
  config: ConfigDe<"worker">,
  log: Logger,
  ajustes: { ventanaMs?: number; lockDurationMs?: number; stalledIntervalMs?: number } = {},
): Promise<ProcesoWorker> {
  const bd = crearBdSistema(config.DATABASE_URL_SYSTEM, "worker", 10);
  const conexion = crearConexionBullmq(config.VALKEY_URL, "worker");

  // Concurrencia 1 en el MVP (WORKER_CONCURRENCY solo admite 1): un lote a la vez, ordenado.
  const consumidor = await iniciarConsumidor({ conexion, bd, log, ...ajustes });

  log.info("worker iniciado");
  return {
    async detener() {
      await consumidor.detener();
      conexion.disconnect();
      await bd.cerrar();
    },
  };
}

if (import.meta.main) {
  const config = cargarConfigOSalir("worker");
  const log = crearLogger("worker", config.LOG_LEVEL);
  const proceso = await iniciarWorker(config, log);
  alApagar(log, proceso.detener);
}
