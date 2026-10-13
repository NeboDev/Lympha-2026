import type { Logger } from "../../platform/logger.ts";
import {
  type ActualizacionTelegram,
  type ClienteTelegram,
  crearClienteTelegram,
} from "./cliente.ts";
import { iniciarPolling, type ManejadorActualizacion } from "./polling.ts";
import { RUTA_WEBHOOK_TELEGRAM } from "./webhook.ts";

export {
  type ActualizacionTelegram,
  type ClienteTelegram,
  crearClienteTelegram,
  ErrorTelegram,
} from "./cliente.ts";
export { iniciarPolling, type ManejadorActualizacion, type Polling } from "./polling.ts";
export { type DepsWebhook, RUTA_WEBHOOK_TELEGRAM, rutaWebhookTelegram } from "./webhook.ts";

export type ModoTelegram = "desactivado" | "polling" | "webhook";

/**
 * Cómo recibe actualizaciones el bot:
 *  - sin token: desactivado;
 *  - con `PUBLIC_API_URL`: webhook (staging y producción siempre; en local solo si se define, p. ej. con un túnel);
 *  - sin `PUBLIC_API_URL` en `APP_ENV=local`: long polling.
 */
export function modoTelegram(c: {
  appEnv: "local" | "staging" | "production";
  token?: string | undefined;
  publicApiUrl?: string | undefined;
}): ModoTelegram {
  if (!c.token) return "desactivado";
  if (c.publicApiUrl) return "webhook";
  return c.appEnv === "local" ? "polling" : "desactivado";
}

/**
 * Manejador de actualizaciones de H1: reconoce el mensaje y no responde. La vinculación por deep link
 * (`/start <token>`) y los avisos llegan en H3.
 */
export function manejadorBasico(log: Logger): ManejadorActualizacion {
  return async (a: ActualizacionTelegram) => {
    log.debug(
      { updateId: a.update_id },
      "Telegram: actualización recibida (sin manejador hasta H3)",
    );
  };
}

export interface ProcesoTelegram {
  modo: ModoTelegram;
  detener(): Promise<void>;
}

export interface OpcionesTelegram {
  modo: ModoTelegram;
  cliente: ClienteTelegram;
  manejar: ManejadorActualizacion;
  log: Logger;
  publicApiUrl?: string | undefined;
  webhookSecret?: string | undefined;
}

/** Deja a Telegram entregando actualizaciones según el modo: polling local o `setWebhook`. */
export async function iniciarTelegram(op: OpcionesTelegram): Promise<ProcesoTelegram> {
  if (op.modo === "polling") {
    const polling = await iniciarPolling({ cliente: op.cliente, manejar: op.manejar, log: op.log });
    op.log.info("Telegram: long polling (APP_ENV=local sin PUBLIC_API_URL)");
    return { modo: "polling", detener: () => polling.detener() };
  }
  if (op.modo === "webhook") {
    if (!op.publicApiUrl || !op.webhookSecret)
      throw new Error("webhook sin PUBLIC_API_URL o secreto");
    await op.cliente.fijarWebhook(
      new URL(RUTA_WEBHOOK_TELEGRAM, op.publicApiUrl).toString(),
      op.webhookSecret,
    );
    op.log.info("Telegram: webhook registrado");
    return { modo: "webhook", detener: async () => undefined };
  }
  op.log.info("Telegram: desactivado (sin TELEGRAM_BOT_TOKEN)");
  return { modo: "desactivado", detener: async () => undefined };
}
