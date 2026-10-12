import { contarPendientes, escucharSalida } from "../modules/notificaciones/index.ts";
import { type ConfigDe, cargarConfigOSalir } from "../platform/config.ts";
import { crearBdSistema } from "../platform/db.ts";
import { crearLogger, type Logger } from "../platform/logger.ts";
import { alApagar } from "../platform/proceso.ts";

export interface ProcesoNotifier {
  detener(): Promise<void>;
}

/**
 * Esqueleto de H0. Cada NOTIFIER_POLL_MS (o antes, al recibir NOTIFY lympha_salida) mira la bandeja
 * de salida. El envío por Telegram (reclamarPendientes + canal) llega en H3; hasta entonces solo
 * observa, para no consumir intentos de avisos que nadie puede entregar.
 */
export async function iniciarNotifier(
  config: ConfigDe<"notifier">,
  log: Logger,
): Promise<ProcesoNotifier> {
  const bd = crearBdSistema(config.DATABASE_URL_SYSTEM, "notifier", 3);

  let pendientesAntes = -1;
  async function revisar(): Promise<void> {
    try {
      const n = await contarPendientes(bd);
      if (n !== pendientesAntes) log.info({ pendientes: n }, "bandeja de salida");
      pendientesAntes = n;
    } catch (error) {
      log.error({ err: error }, "no se pudo consultar la bandeja de salida");
    }
  }

  const escucha = await escucharSalida(
    config.DATABASE_URL_SYSTEM,
    () => void revisar(),
    (e) => log.warn({ err: e }, "LISTEN lympha_salida: reconectando"),
  );
  const temporizador = setInterval(() => void revisar(), config.NOTIFIER_POLL_MS);
  await revisar();

  log.info("notifier iniciado (sin canal de envío hasta H3)");
  return {
    async detener() {
      clearInterval(temporizador);
      await escucha.cerrar();
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
