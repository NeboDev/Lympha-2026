import {
  type CanalTelegram,
  contarAlarmasAbiertas,
  contarPendientes,
  crearEnviador,
  escucharSalida,
} from "../modules/notificaciones/index.ts";
import { crearClienteTelegram } from "../modules/telegram/index.ts";
import { type ConfigDe, cargarConfigOSalir } from "../platform/config.ts";
import { crearBdSistema } from "../platform/db.ts";
import { crearLogger, type Logger } from "../platform/logger.ts";
import { crearRegistro, servirMetricas } from "../platform/metricas.ts";
import { alApagar } from "../platform/proceso.ts";

export interface ProcesoNotifier {
  detener(): Promise<void>;
  metricas(): Promise<string>;
  /** Fuerza una pasada de envío (las pruebas no esperan al sondeo). */
  procesarAhora(): Promise<number>;
}

export interface AjustesNotifier {
  /** Sustituye el canal de Telegram (pruebas). */
  canal?: CanalTelegram;
  /** Sustituye `fetch` del cliente de Telegram (pruebas con un Telegram falso). */
  fetchTelegram?: typeof fetch;
  arrendamientoS?: number;
  lote?: number;
}

/**
 * Notifier: entrega por Telegram lo que hay en `app.notificaciones_salida`. Despierta con `NOTIFY lympha_salida`
 * (que el worker dispara al confirmar la transacción de una alarma) y, por si se pierde un NOTIFY, también
 * cada NOTIFIER_POLL_MS. Varias instancias pueden correr a la vez: `FOR UPDATE SKIP LOCKED` las reparte.
 */
export async function iniciarNotifier(
  config: ConfigDe<"notifier">,
  log: Logger,
  ajustes: AjustesNotifier = {},
): Promise<ProcesoNotifier> {
  const bd = crearBdSistema(config.DATABASE_URL_SYSTEM, "notifier", 3);

  const registro = crearRegistro();
  const enviados = registro.contador(
    "lympha_avisos_enviados_total",
    "Avisos entregados a Telegram",
  );
  const reintentos = registro.contador(
    "lympha_avisos_reintentos_total",
    "Avisos reprogramados tras un error",
  );
  const fallidos = registro.contador(
    "lympha_avisos_fallidos_total",
    "Avisos que no se pudieron entregar",
  );
  const descartados = registro.contador(
    "lympha_avisos_descartados_total",
    "Avisos descartados porque el usuario ya no recibe mensajes",
  );
  const erroresTelegram = registro.contador(
    "lympha_telegram_errores_total",
    "Errores de la API de Telegram al enviar",
    ["codigo"],
  );
  const latencia = registro.histograma(
    "lympha_aviso_latencia_segundos",
    "Segundos entre que un aviso puede salir y su primer envío exitoso (RNF-15: p95 de 60 s)",
    [0.5, 1, 2, 5, 10, 20, 30, 45, 60, 120, 300],
  );
  registro.medidor("lympha_outbox_pendientes", "Avisos pendientes en la bandeja de salida", () =>
    contarPendientes(bd),
  );
  registro.medidorEtiquetado(
    "lympha_alarmas_abiertas",
    "Alarmas sin resolver por tipo",
    "tipo",
    () => contarAlarmasAbiertas(bd),
  );
  const servidorMetricas = config.METRICS_PORT
    ? await servirMetricas(registro, config.METRICS_PORT)
    : null;

  const canal =
    ajustes.canal ??
    (config.TELEGRAM_BOT_TOKEN
      ? crearClienteTelegram(config.TELEGRAM_BOT_TOKEN, ajustes.fetchTelegram)
      : null);
  const enviador = canal
    ? crearEnviador({
        bd,
        telegram: canal,
        log,
        ...(ajustes.arrendamientoS !== undefined ? { arrendamientoS: ajustes.arrendamientoS } : {}),
        ...(ajustes.lote !== undefined ? { lote: ajustes.lote } : {}),
        metricas: {
          enviados: () => enviados.inc(),
          reintentos: () => reintentos.inc(),
          fallidos: () => fallidos.inc(),
          descartados: () => descartados.inc(),
          errores: (codigo) => erroresTelegram.inc({ codigo }),
          latencia: (s) => latencia.observar(s),
        },
      })
    : null;
  if (!enviador) log.warn("notifier sin TELEGRAM_BOT_TOKEN: los avisos se acumulan en la bandeja");

  // Una sola pasada a la vez por proceso; si llega un NOTIFY mientras corre, se repite al terminar.
  let corriendo: Promise<number> | null = null;
  let repetir = false;
  let detenido = false;
  let pendientesAntes = -1;

  async function pasada(): Promise<number> {
    try {
      if (enviador) return await enviador.procesar();
      const n = await contarPendientes(bd);
      if (n !== pendientesAntes) log.info({ pendientes: n }, "bandeja de salida");
      pendientesAntes = n;
      return 0;
    } catch (error) {
      log.error({ err: error }, "no se pudo procesar la bandeja de salida");
      return 0;
    }
  }

  function revisar(): Promise<number> {
    if (corriendo) {
      repetir = true;
      return corriendo;
    }
    corriendo = (async () => {
      let total = 0;
      do {
        repetir = false;
        total += await pasada();
      } while (repetir && !detenido);
      return total;
    })().finally(() => {
      corriendo = null;
    });
    return corriendo;
  }

  const escucha = await escucharSalida(
    config.DATABASE_URL_SYSTEM,
    () => void revisar(),
    (e) => log.warn({ err: e }, "LISTEN lympha_salida: reconectando"),
  );
  const temporizador = setInterval(() => void revisar(), config.NOTIFIER_POLL_MS);
  await revisar();

  log.info({ envio: enviador !== null }, "notifier iniciado");
  return {
    metricas: () => registro.texto(),
    procesarAhora: () => revisar(),
    async detener() {
      detenido = true;
      clearInterval(temporizador);
      await escucha.cerrar();
      await corriendo?.catch(() => undefined);
      servidorMetricas?.close();
      await bd.cerrar();
    },
  };
}

if (import.meta.main) {
  const config = cargarConfigOSalir("notifier");
  const log = crearLogger("notifier", config.LOG_LEVEL);
  const proceso = await iniciarNotifier(config, log);
  alApagar(log, proceso.detener);
}
