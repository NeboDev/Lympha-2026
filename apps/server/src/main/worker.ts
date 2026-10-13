import { crearEvaluador } from "../modules/calidad/index.ts";
import { crearResolvedorNodo } from "../modules/dispositivos/index.ts";
import { iniciarConsumidor } from "../modules/telemetria/index.ts";
import { type ConfigDe, cargarConfigOSalir } from "../platform/config.ts";
import { crearBdSistema } from "../platform/db.ts";
import { crearLogger, type Logger } from "../platform/logger.ts";
import { crearRegistro, servirMetricas } from "../platform/metricas.ts";
import { alApagar } from "../platform/proceso.ts";
import { crearConexionBullmq, crearValkey } from "../platform/valkey.ts";

export interface ProcesoWorker {
  detener(): Promise<void>;
  metricas(): Promise<string>;
}

export async function iniciarWorker(
  config: ConfigDe<"worker">,
  log: Logger,
  ajustes: { ventanaMs?: number; lockDurationMs?: number; stalledIntervalMs?: number } = {},
): Promise<ProcesoWorker> {
  const bd = crearBdSistema(config.DATABASE_URL_SYSTEM, "worker", 10);
  const conexion = crearConexionBullmq(config.VALKEY_URL, "worker");
  // Conexión de uso general: memoria del motor WQI, caché de nodos y publicación del estado.
  const valkey = crearValkey(config.VALKEY_URL, "worker");
  const evaluador = crearEvaluador({ bd, valkey, resolver: crearResolvedorNodo(valkey, bd), log });

  const registro = crearRegistro();
  const insertadas = registro.contador(
    "lympha_lecturas_insertadas_total",
    "Lecturas nuevas guardadas en ts.lecturas",
  );
  const duplicadas = registro.contador(
    "lympha_lecturas_duplicadas_total",
    "Lecturas ya existentes (reentregas) ignoradas",
  );
  const lotes = registro.contador("lympha_lotes_guardados_total", "Lotes de lecturas guardados");
  const eventos = registro.contador(
    "lympha_eventos_nodo_total",
    "Cambios de conexión y atributos de nodos aplicados",
  );
  const servidorMetricas = config.METRICS_PORT
    ? await servirMetricas(registro, config.METRICS_PORT)
    : null;

  // Concurrencia 1 en el MVP (WORKER_CONCURRENCY solo admite 1): un lote a la vez, ordenado.
  const consumidor = await iniciarConsumidor({
    conexion,
    bd,
    log,
    alEvaluar: (filas) => evaluador.procesar(filas),
    alGuardar: (r, n) => {
      insertadas.inc({}, r.insertadas);
      duplicadas.inc({}, r.duplicadas);
      eventos.inc({}, n);
      lotes.inc();
    },
    ...ajustes,
  });

  log.info("worker iniciado");
  return {
    metricas: () => registro.texto(),
    async detener() {
      servidorMetricas?.close();
      await consumidor.detener();
      conexion.disconnect();
      valkey.disconnect();
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
