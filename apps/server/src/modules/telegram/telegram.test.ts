import { describe, expect, it, vi } from "vitest";
import { crearServidorHttp } from "../../platform/http.ts";
import { crearLogger } from "../../platform/logger.ts";
import {
  type ActualizacionTelegram,
  type ClienteTelegram,
  crearClienteTelegram,
  ErrorTelegram,
  iniciarPolling,
  iniciarTelegram,
  modoTelegram,
  RUTA_WEBHOOK_TELEGRAM,
  rutaWebhookTelegram,
} from "./index.ts";

const log = crearLogger("prueba", "silent");
const SECRETO = "secreto-del-webhook-de-prueba";

describe("modoTelegram", () => {
  it.each([
    ["local sin PUBLIC_API_URL: long polling", { appEnv: "local", token: "t" }, "polling"],
    [
      "local con PUBLIC_API_URL: webhook",
      { appEnv: "local", token: "t", publicApiUrl: "https://x.ngrok.app" },
      "webhook",
    ],
    [
      "staging con PUBLIC_API_URL: webhook",
      { appEnv: "staging", token: "t", publicApiUrl: "https://api.staging" },
      "webhook",
    ],
    [
      "producción sin PUBLIC_API_URL: nunca polling",
      { appEnv: "production", token: "t" },
      "desactivado",
    ],
    ["sin token: desactivado", { appEnv: "local" }, "desactivado"],
    [
      "sin token aunque haya URL",
      { appEnv: "local", publicApiUrl: "https://x.app" },
      "desactivado",
    ],
  ] as const)("%s", (_nombre, entrada, esperado) => {
    expect(modoTelegram(entrada)).toBe(esperado);
  });
});

function clienteFalso(): ClienteTelegram & {
  llamadas: string[];
  encolar(lote: ActualizacionTelegram[] | Error): void;
} {
  const cola: (ActualizacionTelegram[] | Error)[] = [];
  const llamadas: string[] = [];
  return {
    llamadas,
    encolar: (x) => cola.push(x),
    async obtenerActualizaciones(offset, _espera, senal) {
      llamadas.push(`getUpdates:${offset}`);
      const siguiente = cola.shift();
      if (siguiente instanceof Error) throw siguiente;
      if (siguiente) return siguiente;
      // sin novedades: espera hasta que se detenga (como el long polling real)
      await new Promise<void>((resolve) => senal?.addEventListener("abort", () => resolve()));
      throw new Error("abortado");
    },
    fijarWebhook: async (url, secreto) => {
      llamadas.push(`setWebhook:${url}:${secreto}`);
    },
    borrarWebhook: async () => {
      llamadas.push("deleteWebhook");
    },
    enviarMensaje: async () => undefined,
    obtenerNombreBot: async () => "lympha_prueba_bot",
  };
}

const upd = (id: number): ActualizacionTelegram => ({
  update_id: id,
  message: { chat: { id: 1 }, text: "/start" },
});

const esperar = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

describe("long polling", () => {
  it("borra el webhook, entrega las actualizaciones en orden y avanza el offset", async () => {
    const cliente = clienteFalso();
    cliente.encolar([upd(10), upd(11)]);
    const vistas: number[] = [];
    const polling = await iniciarPolling({
      cliente,
      log,
      manejar: async (a) => {
        vistas.push(a.update_id);
      },
    });
    await esperar(() => cliente.llamadas.filter((l) => l.startsWith("getUpdates")).length >= 2);
    await polling.detener();
    expect(cliente.llamadas[0]).toBe("deleteWebhook");
    expect(vistas).toEqual([10, 11]);
    expect(cliente.llamadas).toContain("getUpdates:12");
  });

  it("una actualización que falla se salta y el offset avanza igual", async () => {
    const cliente = clienteFalso();
    cliente.encolar([upd(1), upd(2)]);
    const vistas: number[] = [];
    const polling = await iniciarPolling({
      cliente,
      log,
      manejar: async (a) => {
        if (a.update_id === 1) throw new Error("falla");
        vistas.push(a.update_id);
      },
    });
    await esperar(() => vistas.length === 1);
    await polling.detener();
    expect(vistas).toEqual([2]);
  });

  it("se recupera de un error de red y vuelve a leer", async () => {
    const cliente = clienteFalso();
    cliente.encolar(new ErrorTelegram("getUpdates", "no se pudo conectar"));
    cliente.encolar([upd(5)]);
    const vistas: number[] = [];
    const polling = await iniciarPolling({
      cliente,
      log,
      esperaErrorMs: 5,
      manejar: async (a) => {
        vistas.push(a.update_id);
      },
    });
    await esperar(() => vistas.length === 1);
    await polling.detener();
  });
});

describe("iniciarTelegram", () => {
  it("modo polling: arranca el bucle; modo webhook: registra la URL con su secreto", async () => {
    const polling = clienteFalso();
    const p = await iniciarTelegram({
      modo: "polling",
      cliente: polling,
      manejar: async () => undefined,
      log,
    });
    expect(p.modo).toBe("polling");
    await p.detener();

    const webhook = clienteFalso();
    const w = await iniciarTelegram({
      modo: "webhook",
      cliente: webhook,
      manejar: async () => undefined,
      log,
      publicApiUrl: "https://api.example.com",
      webhookSecret: SECRETO,
    });
    expect(w.modo).toBe("webhook");
    expect(webhook.llamadas).toEqual([
      `setWebhook:https://api.example.com/telegram/webhook:${SECRETO}`,
    ]);
  });
});

describe("webhook", () => {
  async function servidor(manejar = vi.fn(async () => undefined)) {
    const app = crearServidorHttp(log);
    await app.register(rutaWebhookTelegram, { secreto: SECRETO, manejar });
    return { app, manejar };
  }
  const cuerpo = JSON.stringify(upd(7));

  it("acepta una actualización con el secreto correcto", async () => {
    const { app, manejar } = await servidor();
    const r = await app.inject({
      method: "POST",
      url: RUTA_WEBHOOK_TELEGRAM,
      headers: { "x-telegram-bot-api-secret-token": SECRETO, "content-type": "application/json" },
      payload: cuerpo,
    });
    expect(r.statusCode).toBe(200);
    expect(manejar).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["sin cabecera", {}],
    ["con otro secreto", { "x-telegram-bot-api-secret-token": "otro-secreto-distinto-123456" }],
    ["con un secreto de otra longitud", { "x-telegram-bot-api-secret-token": "x" }],
  ])("responde 404 %s y no procesa nada", async (_nombre, headers) => {
    const { app, manejar } = await servidor();
    const r = await app.inject({
      method: "POST",
      url: RUTA_WEBHOOK_TELEGRAM,
      headers: { "content-type": "application/json", ...headers },
      payload: cuerpo,
    });
    expect(r.statusCode).toBe(404);
    expect(manejar).not.toHaveBeenCalled();
  });

  it("rechaza un cuerpo que no es una actualización", async () => {
    const { app } = await servidor();
    const r = await app.inject({
      method: "POST",
      url: RUTA_WEBHOOK_TELEGRAM,
      headers: { "x-telegram-bot-api-secret-token": SECRETO, "content-type": "application/json" },
      payload: JSON.stringify({ hola: 1 }),
    });
    expect(r.statusCode).toBe(400);
  });
});

describe("cliente de la Bot API", () => {
  it("nunca deja el token en los errores", async () => {
    const TOKEN = "123456:TOKEN-SECRETO";
    const rota = vi
      .fn()
      .mockRejectedValue(new Error(`fetch failed https://api.telegram.org/bot${TOKEN}/getUpdates`));
    const cliente = crearClienteTelegram(TOKEN, rota as unknown as typeof fetch);
    const error = await cliente.borrarWebhook().catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(ErrorTelegram);
    expect((error as Error).message).not.toContain(TOKEN);

    const denegada = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }), {
        status: 401,
      }),
    );
    const e2 = await crearClienteTelegram(TOKEN, denegada as unknown as typeof fetch)
      .fijarWebhook("https://x", "s")
      .catch((e: unknown) => e as ErrorTelegram);
    expect((e2 as ErrorTelegram).codigo).toBe(401);
    expect((e2 as Error).message).not.toContain(TOKEN);
  });

  it("descarta las actualizaciones malformadas sin frenar a las buenas", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, result: [{ nada: 1 }, upd(3)] }), { status: 200 }),
      );
    const r = await crearClienteTelegram("t", f as unknown as typeof fetch).obtenerActualizaciones(
      0,
      1,
    );
    expect(r.map((a) => a.update_id)).toEqual([3]);
  });
});
