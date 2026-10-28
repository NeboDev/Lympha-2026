import { canalEspacio, type EventoConexion } from "@lympha/contracts";
import {
  aplicarCiclo,
  iniciarMantenimiento,
  resolverSinConexion,
} from "../modules/alarmas/index.ts";
import {
  CANAL_INVALIDAR_CALIBRACION,
  calibrarFilas,
  crearCacheCalibracion,
} from "../modules/calibracion/index.ts";
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

  // Coeficientes de calibración por nodo: en memoria, invalidados por la API (pub/sub) y con caducidad propia.
  const cacheCalibracion = crearCacheCalibracion(bd);
  const suscriptor = crearValkey(config.VALKEY_URL, "worker-calibracion");
  suscriptor.on("message", (_canal, nodoId) => cacheCalibracion.invalidar(nodoId));
  await suscriptor.subscribe(CANAL_INVALIDAR_CALIBRACION);

  const registro = crearRegistro();
  const avisosEncolados = registro.contador(
    "lympha_avisos_encolados_total",
    "Avisos escritos en la bandeja de salida por alarmas",
  );
  const cambiosAlarma = registro.contador(
    "lympha_alarmas_cambios_total",
    "Cambios en el ciclo de vida de las alarmas",
    ["tipo", "cambio"],
  );
  const evaluador = crearEvaluador({
    bd,
    valkey,
    resolver: crearResolvedorNodo(valkey, bd),
    log,
    // Alarmas y avisos en la misma transacción que el estado que los causa (H3).
    alGuardarEstados: async (tx, estados) => {
      const r = await aplicarCiclo(tx, estados);
      avisosEncolados.inc({}, r.avisos);
      for (const e of r.eventos) cambiosAlarma.inc({ tipo: e.tipo, cambio: e.cambio });
      return r.eventos;
    },
  });

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
    alCalibrar: async (filas) =>
      calibrarFilas(filas, await cacheCalibracion.coeficientes(filas.map((f) => f.nodoId))),
    alEvaluar: (filas) => evaluador.procesar(filas),
    // Un nodo que vuelve cierra su alarma de desconexión al instante; si esto falla, el barrido la cierra.
    alReconectar: async (nodoId) => {
      try {
        const r = await resolverSinConexion(bd, nodoId);
        if (!r) return;
        avisosEncolados.inc({}, r.avisos);
        cambiosAlarma.inc({ tipo: r.evento.tipo, cambio: r.evento.cambio });
        await valkey
          .publish(canalEspacio(r.evento.espacio_id), JSON.stringify(r.evento))
          .catch(() => undefined);
      } catch (error) {
        log.warn(
          { err: error, nodoId },
          "no se pudo cerrar la alarma de desconexión; lo hará el barrido",
        );
      }
    },
    // La PWA se entera por el stream del espacio (RF-13); si Valkey falla, el snapshot de la próxima conexión lo corrige.
    alCambiarConexion: async (c) => {
      const evento: EventoConexion = {
        nodo_id: c.nodoId,
        espacio_id: c.espacioId,
        conectado: c.conectado,
        cambio_conexion_en: c.en.toISOString(),
        actualizado_en: new Date().toISOString(),
      };
      await valkey.publish(canalEspacio(c.espacioId), JSON.stringify(evento));
    },
    alGuardar: (r, n) => {
      insertadas.inc({}, r.insertadas);
      duplicadas.inc({}, r.duplicadas);
      eventos.inc({}, n);
      lotes.inc();
    },
    ...ajustes,
  });

  // Desconexión sostenida, reconexiones perdidas y recordatorios (H3), en la cola `mantenimiento`.
  const mantenimiento = await iniciarMantenimiento({
    conexion,
    valkey,
    bd,
    log,
    cadaMs: config.BARRIDO_MS,
    sinConexionS: config.ALARMA_SIN_CONEXION_S,
    alBarrer: (r) => {
      avisosEncolados.inc({}, r.avisos);
      for (const e of r.eventos) cambiosAlarma.inc({ tipo: e.tipo, cambio: e.cambio });
    },
  });

  log.info("worker iniciado");
  return {
    metricas: () => registro.texto(),
    async detener() {
      servidorMetricas?.close();
      await mantenimiento.detener();
      await consumidor.detener();
      conexion.disconnect();
      suscriptor.disconnect();
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
