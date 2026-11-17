import type { AlmacenAvisos, AvisoDoc, EnviadorTelegram, LoggerAvisos } from "./puertos.ts";

const SILENCIO: LoggerAvisos = { info() {}, warn() {}, error() {} };

export type OpcionesEnviador = {
  almacen: AlmacenAvisos;
  telegram: EnviadorTelegram;
  reloj?: () => Date;
  logger?: LoggerAvisos;
  /** Cuánto se «reserva» un aviso mientras se envía, para que otro proceso no lo duplique. */
  arriendoMs?: number;
  /** Tras estos intentos fallidos el aviso se da por perdido y queda registrado. */
  maxIntentos?: number;
  /** Máximo de avisos por ronda, para no acaparar el turno si hay muchos. */
  maxPorRonda?: number;
};

export type ResumenRonda = { enviados: number; reprogramados: number; fallidos: number };

/** Espera antes del intento número `intentos` (1 = primer reintento): 5 s, 10 s, 20 s… hasta 10 min. */
export function esperaReintentoMs(intentos: number): number {
  return Math.min(10 * 60_000, 5_000 * 2 ** Math.max(0, intentos - 1));
}

type ErrorEnvio = { codigo?: number; reintentarEnS?: number; descripcion?: string };

function leerError(e: unknown): ErrorEnvio & { mensaje: string } {
  const o = (e ?? {}) as ErrorEnvio & { message?: string };
  return {
    codigo: typeof o.codigo === "number" ? o.codigo : undefined,
    reintentarEnS: typeof o.reintentarEnS === "number" ? o.reintentarEnS : undefined,
    descripcion: typeof o.descripcion === "string" ? o.descripcion : undefined,
    mensaje: (o.descripcion ?? o.message ?? "error desconocido").slice(0, 200),
  };
}

/** El chat ya no existe, el bot fue expulsado o el usuario lo bloqueó: reintentar no sirve. */
function esPermanente(e: ErrorEnvio): boolean {
  if (e.codigo === 403) return true;
  return (
    e.codigo === 400 &&
    /chat not found|bot was kicked|bot was blocked|deactivated|group chat was/i.test(
      e.descripcion ?? "",
    )
  );
}

/**
 * Envía los avisos pendientes a Telegram. Garantía **al menos una vez**: si el proceso muere entre
 * enviar y marcar el aviso como enviado, el arrendamiento vence y el aviso puede repetirse.
 */
export function crearEnviador(op: OpcionesEnviador) {
  const reloj = op.reloj ?? (() => new Date());
  const logger = op.logger ?? SILENCIO;
  const arriendoMs = op.arriendoMs ?? 30_000;
  const maxIntentos = op.maxIntentos ?? 8;
  const maxPorRonda = op.maxPorRonda ?? 20;

  async function enviarUno(aviso: AvisoDoc, resumen: ResumenRonda): Promise<void> {
    const id = aviso._id.toHexString();
    const ahora = reloj();
    const chat = await op.almacen.chatDe(aviso.comunidad_id);
    if (chat === null) {
      await op.almacen.marcarFallido(aviso._id, "la comunidad no tiene un chat vinculado");
      logger.warn({ aviso_id: id }, "aviso descartado: sin chat vinculado");
      resumen.fallidos++;
      return;
    }
    try {
      await op.telegram.enviarMensaje(chat, aviso.texto);
    } catch (e) {
      const err = leerError(e);
      const intento = aviso.intentos + 1;
      if (esPermanente(err) || intento >= maxIntentos) {
        await op.almacen.marcarFallido(aviso._id, err.mensaje);
        logger.error({ aviso_id: id, codigo: err.codigo, intentos: intento }, "aviso fallido");
        resumen.fallidos++;
        return;
      }
      const esperaMs =
        err.codigo === 429 ? (err.reintentarEnS ?? 5) * 1000 + 1000 : esperaReintentoMs(intento);
      await op.almacen.reprogramar(aviso._id, new Date(ahora.getTime() + esperaMs), err.mensaje);
      logger.warn(
        { aviso_id: id, codigo: err.codigo, intentos: intento, espera_ms: esperaMs },
        "aviso reprogramado",
      );
      resumen.reprogramados++;
      return;
    }
    await op.almacen.marcarEnviado(aviso._id, reloj());
    resumen.enviados++;
  }

  return {
    /** Una ronda: toma y envía avisos hasta vaciar la bandeja o llegar al máximo. */
    async ronda(): Promise<ResumenRonda> {
      const resumen: ResumenRonda = { enviados: 0, reprogramados: 0, fallidos: 0 };
      for (let i = 0; i < maxPorRonda; i++) {
        const aviso = await op.almacen.tomarSiguiente(reloj(), arriendoMs);
        if (!aviso) break;
        await enviarUno(aviso, resumen);
      }
      return resumen;
    },
  };
}
