import { z } from "zod";

/**
 * Cliente mínimo de la Bot API de Telegram (solo `fetch`, sin dependencias). El token va en la URL
 * que exige Telegram, así que NUNCA se incluye una URL en errores ni logs.
 */

/** Lo que el servidor necesita de una actualización; el resto se conserva sin interpretar. */
export const actualizacionTelegram = z
  .object({
    update_id: z.number().int(),
    message: z
      .object({
        text: z.string().optional(),
        chat: z
          .object({
            id: z.number().int(),
            type: z.string().optional(),
            title: z.string().optional(),
          })
          .passthrough(),
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
/** Subir un archivo tarda más que un mensaje. */
const ESPERA_DOCUMENTO_MS = 60_000;

export type ArchivoTelegram = { nombre: string; contenido: Uint8Array; tipo?: string };

export interface ClienteTelegram {
  /** Long polling: espera hasta `esperaS` segundos por actualizaciones con `update_id >= offset`. */
  obtenerActualizaciones(
    offset: number,
    esperaS: number,
    senal?: AbortSignal,
  ): Promise<ActualizacionTelegram[]>;
  /** Telegram rechaza `getUpdates` si hay un webhook activo: se borra antes de empezar. */
  borrarWebhook(): Promise<void>;
  enviarMensaje(chatId: number, texto: string): Promise<void>;
  /** Sube un archivo (el reporte PDF) con una leyenda opcional (máx. 1024 caracteres). */
  enviarDocumento(chatId: number, archivo: ArchivoTelegram, leyenda?: string): Promise<void>;
  /** Nombre de usuario del bot (sin @). */
  obtenerNombreBot(): Promise<string>;
}

type Fetch = typeof fetch;

export function crearClienteTelegram(token: string, fetchImpl: Fetch = fetch): ClienteTelegram {
  async function llamar<T>(
    metodo: string,
    cuerpo: Record<string, unknown> | FormData,
    senal?: AbortSignal,
    esperaMs: number = ESPERA_MAXIMA_MS,
  ): Promise<T> {
    let respuesta: Response;
    try {
      // Con FormData fetch pone solo el `content-type` multipart (con su frontera).
      const esFormulario = cuerpo instanceof FormData;
      respuesta = await fetchImpl(`https://api.telegram.org/bot${token}/${metodo}`, {
        method: "POST",
        ...(esFormulario ? {} : { headers: { "content-type": "application/json" } }),
        body: esFormulario ? cuerpo : JSON.stringify(cuerpo),
        signal: senal ?? AbortSignal.timeout(esperaMs),
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
    async borrarWebhook() {
      await llamar("deleteWebhook", { drop_pending_updates: false });
    },
    async enviarMensaje(chatId, texto) {
      await llamar("sendMessage", {
        chat_id: chatId,
        text: texto,
        link_preview_options: { is_disabled: true },
      });
    },
    async enviarDocumento(chatId, archivo, leyenda) {
      const formulario = new FormData();
      formulario.set("chat_id", String(chatId));
      if (leyenda) formulario.set("caption", leyenda);
      formulario.set(
        "document",
        new Blob([archivo.contenido], { type: archivo.tipo ?? "application/pdf" }),
        archivo.nombre,
      );
      await llamar("sendDocument", formulario, undefined, ESPERA_DOCUMENTO_MS);
    },
    async obtenerNombreBot() {
      const bot = await llamar<{ username?: string }>("getMe", {});
      if (!bot.username) throw new ErrorTelegram("getMe", "el bot no tiene nombre de usuario");
      return bot.username;
    },
  };
}
