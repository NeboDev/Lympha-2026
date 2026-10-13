import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { NoEncontrado } from "../../platform/errors.ts";
import { actualizacionTelegram } from "./cliente.ts";
import type { ManejadorActualizacion } from "./polling.ts";

export const RUTA_WEBHOOK_TELEGRAM = "/telegram/webhook";

export interface DepsWebhook {
  /** El mismo valor que se entregó a `setWebhook` como `secret_token`. */
  secreto: string;
  manejar: ManejadorActualizacion;
}

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Webhook de Telegram. Solo se registra cuando Telegram está en modo webhook (hay PUBLIC_API_URL). Telegram
 * envía el secreto en la cabecera `X-Telegram-Bot-Api-Secret-Token`; sin él (o con otro) la ruta responde 404,
 * como si no existiera. No devuelve datos de ningún espacio.
 */
export const rutaWebhookTelegram: FastifyPluginAsync<DepsWebhook> = async (app, deps) => {
  app.post(RUTA_WEBHOOK_TELEGRAM, async (req, reply) => {
    const recibido = req.headers["x-telegram-bot-api-secret-token"];
    if (typeof recibido !== "string" || !iguales(recibido, deps.secreto)) throw new NoEncontrado();
    const actualizacion = actualizacionTelegram.safeParse(req.body);
    if (!actualizacion.success)
      return reply.code(400).send({ codigo: "invalido", mensaje: "Solicitud inválida" });
    await deps.manejar(actualizacion.data);
    return reply.code(200).send({});
  });
};
