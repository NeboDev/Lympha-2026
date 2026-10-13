import { z } from "zod";

/**
 * Cliente mínimo de la Bot API de Telegram (solo `fetch`, sin dependencias). El token va en la URL que exige
 * Telegram, así que NUNCA se incluye una URL en errores ni logs.
 */

/** Lo que el servidor necesita de una actualización; el resto se conserva sin interpretar. */
export const actualizacionTelegram = z
  .object({
    update_id: z.number().int(),
    message: z
      .object({
        text: z.string().optional(),
        chat: z.object({ id: z.number().int(), type: z.string().optional() }).passthrough(),
        from: z.object({ id: z.number().int() }).passthrough().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type ActualizacionTelegram = z.infer<typeof actualizacionTelegram>;

export class ErrorTelegram extends Error {
  /** Código HTTP/Bot API; `undefined` = no hubo respuesta (red caída o tiempo agotado). */
  readonly codigo: number | undefined;
  /** Segundos que pide esperar Telegram (429). */
  readonly reintentarEnS: number | undefined;
  /** Descripción de Telegram, sin la URL ni el token. */
  readonly descripcion: string;
  constructor(metodo: string, descripcion: string, codigo?: number, reintentarEnS?: number) {
    super(`Telegram ${metodo}: ${descripcion}`);
    this.name = "ErrorTelegram";
    this.codigo = codigo;
    this.reintentarEnS = reintentarEnS;
    this.descripcion = descripcion;
  }
}

/** Tiempo máximo de espera de una llamada normal (las de long polling traen su propia señal). */
const ESPERA_MAXIMA_MS = 15_000;

export interface ClienteTelegram {
  /** Long polling: espera hasta `esperaS` segundos por actualizaciones con `update_id >= offset`. */
  obtenerActualizaciones(
    offset: number,
    esperaS: number,
    senal?: AbortSignal,
  ): Promise<ActualizacionTelegram[]>;
  fijarWebhook(url: string, secreto: string): Promise<void>;
  borrarWebhook(): Promise<void>;
  enviarMensaje(chatId: number, texto: string): Promise<void>;
  /** Nombre de usuario del bot (sin @), para armar el enlace `https://t.me/<bot>?start=<token>`. */
  obtenerNombreBot(): Promise<string>;
}

type Fetch = typeof fetch;

export function crearClienteTelegram(token: string, fetchImpl: Fetch = fetch): ClienteTelegram {
  async function llamar<T>(
    metodo: string,
    cuerpo: Record<string, unknown>,
    senal?: AbortSignal,
  ): Promise<T> {
    let respuesta: Response;
    try {
      respuesta = await fetchImpl(`https://api.telegram.org/bot${token}/${metodo}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cuerpo),
        signal: senal ?? AbortSignal.timeout(ESPERA_MAXIMA_MS),
      });
    } catch (error) {
      if (senal?.aborted) throw error;
      // El error de red de fetch puede traer la URL (con el token): se descarta.
      throw new ErrorTelegram(metodo, "no se pudo conectar");
    }
    const json = (await respuesta.json().catch(() => null)) as {
      ok?: boolean;
      result?: T;
      description?: string;
      error_code?: number;
      parameters?: { retry_after?: number };
    } | null;
    if (!json?.ok) {
      throw new ErrorTelegram(
        metodo,
        json?.description ?? `HTTP ${respuesta.status}`,
        json?.error_code ?? respuesta.status,
        json?.parameters?.retry_after,
      );
    }
    return json.result as T;
  }

  return {
    async obtenerActualizaciones(offset, esperaS, senal) {
      const crudas = await llamar<unknown[]>(
        "getUpdates",
        { offset, timeout: esperaS, allowed_updates: ["message"] },
        senal,
      );
      // Una actualización malformada no debe frenar la cola: se omite.
      return crudas.flatMap((c) => {
        const r = actualizacionTelegram.safeParse(c);
        return r.success ? [r.data] : [];
      });
    },
    async fijarWebhook(url, secreto) {
      await llamar("setWebhook", {
        url,
        secret_token: secreto,
        allowed_updates: ["message"],
        drop_pending_updates: false,
      });
    },
    async borrarWebhook() {
      await llamar("deleteWebhook", { drop_pending_updates: false });
    },
    async enviarMensaje(chatId, texto) {
      await llamar("sendMessage", { chat_id: chatId, text: texto });
    },
    async obtenerNombreBot() {
      const bot = await llamar<{ username?: string }>("getMe", {});
      if (!bot.username) throw new ErrorTelegram("getMe", "el bot no tiene nombre de usuario");
      return bot.username;
    },
  };
}
