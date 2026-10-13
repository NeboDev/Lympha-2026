/**
 * Telegram falso para las pruebas: se inyecta como `fetch` del cliente real (`crearClienteTelegram`), así que
 * se ejercita el mismo código de producción (cuerpo JSON, códigos de error, `retry_after`, tiempo agotado).
 */

export interface EntregaFalsa {
  chatId: number;
  texto: string;
  /** Milisegundos Unix en que el "servidor" de Telegram aceptó el mensaje. */
  en: number;
}

export interface Llamada {
  /** Número de llamada a `sendMessage` desde 1 (incluye las que fallan). */
  n: number;
  chatId: number;
  texto: string;
}

/** Qué responde Telegram. `colgar` simula un tiempo agotado: la llamada no regresa hasta que se aborta. */
export type Respuesta =
  | { ok: true }
  | { ok: false; codigo: number; descripcion: string; reintentarEnS?: number }
  | { colgar: true }
  /** Telegram acepta y entrega, pero la respuesta se pierde (el nodo cliente ve un error de red). */
  | { entregarYPerderRespuesta: true };

export interface TelegramFalso {
  fetch: typeof fetch;
  /** Mensajes que Telegram aceptó (los que de verdad le llegarían al usuario). */
  entregas: EntregaFalsa[];
  /** Todas las llamadas a sendMessage, también las fallidas. */
  llamadas: Llamada[];
  /** Cambia el guion de respuestas. */
  responder(fn: (llamada: Llamada) => Respuesta | Promise<Respuesta>): void;
}

export function crearTelegramFalso(
  guion: (llamada: Llamada) => Respuesta | Promise<Respuesta> = () => ({ ok: true }),
  latenciaMs = 0,
): TelegramFalso {
  let responder = guion;
  const entregas: EntregaFalsa[] = [];
  const llamadas: Llamada[] = [];
  let n = 0;

  const json = (status: number, cuerpo: unknown) =>
    new Response(JSON.stringify(cuerpo), {
      status,
      headers: { "content-type": "application/json" },
    });

  const falso = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const metodo = /\/bot[^/]+\/(\w+)$/.exec(url)?.[1];
    if (metodo !== "sendMessage") return json(200, { ok: true, result: true });

    const cuerpo = JSON.parse(String(init?.body ?? "{}")) as { chat_id: number; text: string };
    const llamada: Llamada = { n: ++n, chatId: cuerpo.chat_id, texto: cuerpo.text };
    llamadas.push(llamada);
    if (latenciaMs > 0) await new Promise((r) => setTimeout(r, latenciaMs));

    const r = await responder(llamada);
    if ("colgar" in r) {
      return new Promise<Response>((_, rechazar) => {
        init?.signal?.addEventListener("abort", () =>
          rechazar(new DOMException("agotado", "TimeoutError")),
        );
      });
    }
    if ("entregarYPerderRespuesta" in r) {
      entregas.push({ chatId: llamada.chatId, texto: llamada.texto, en: Date.now() });
      throw new TypeError("fetch failed");
    }
    if (r.ok) {
      entregas.push({ chatId: llamada.chatId, texto: llamada.texto, en: Date.now() });
      return json(200, { ok: true, result: { message_id: llamada.n } });
    }
    return json(r.codigo, {
      ok: false,
      error_code: r.codigo,
      description: r.descripcion,
      ...(r.reintentarEnS ? { parameters: { retry_after: r.reintentarEnS } } : {}),
    });
  }) as typeof fetch;

  return {
    fetch: falso,
    entregas,
    llamadas,
    responder(fn) {
      responder = fn;
    },
  };
}
