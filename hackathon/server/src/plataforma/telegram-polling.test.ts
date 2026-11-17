import { describe, expect, it, vi } from "vitest";
import type { ActualizacionTelegram } from "./telegram-api.ts";
import { iniciarPolling } from "./telegram-polling.ts";

const act = (id: number, texto = "/estado"): ActualizacionTelegram => ({
  update_id: id,
  message: { text: texto, chat: { id: 1, type: "private" } },
});

/** Cliente que entrega lotes en orden y, cuando se acaban, se queda esperando hasta que lo aborten. */
function clienteConLotes(lotes: (ActualizacionTelegram[] | Error)[]) {
  const offsets: number[] = [];
  const borrarWebhook = vi.fn(async () => {});
  return {
    offsets,
    borrarWebhook,
    cliente: {
      borrarWebhook,
      async obtenerActualizaciones(offset: number, _esperaS: number, senal?: AbortSignal) {
        offsets.push(offset);
        const siguiente = lotes.shift();
        if (siguiente instanceof Error) throw siguiente;
        if (siguiente) return siguiente;
        return new Promise<ActualizacionTelegram[]>((_r, rechazar) => {
          senal?.addEventListener("abort", () =>
            rechazar(new DOMException("abortado", "AbortError")),
          );
        });
      },
    },
  };
}

const logger = () => ({ warn: vi.fn(), error: vi.fn() });

describe("iniciarPolling", () => {
  it("borra el webhook antes de empezar y entrega cada actualización", async () => {
    const { cliente, borrarWebhook } = clienteConLotes([[act(1), act(2)]]);
    const manejadas: number[] = [];
    const p = await iniciarPolling({
      cliente,
      manejar: async (a) => void manejadas.push(a.update_id),
      logger: logger(),
    });
    await vi.waitFor(() => expect(manejadas).toEqual([1, 2]));
    expect(borrarWebhook).toHaveBeenCalledTimes(1);
    await p.detener();
  });

  it("avanza el offset al siguiente update_id para no repetir mensajes", async () => {
    const { cliente, offsets } = clienteConLotes([[act(5)], [act(9)]]);
    const p = await iniciarPolling({ cliente, manejar: async () => {}, logger: logger() });
    await vi.waitFor(() => expect(offsets).toEqual([0, 6, 10]));
    await p.detener();
  });

  it("una actualización que falla se registra y se salta, sin frenar las demás", async () => {
    const { cliente } = clienteConLotes([[act(1), act(2), act(3)]]);
    const log = logger();
    const manejadas: number[] = [];
    const p = await iniciarPolling({
      cliente,
      manejar: async (a) => {
        if (a.update_id === 2) throw new Error("falló el manejo");
        manejadas.push(a.update_id);
      },
      logger: log,
    });
    await vi.waitFor(() => expect(manejadas).toEqual([1, 3]));
    expect(log.error).toHaveBeenCalledTimes(1);
    await p.detener();
  });

  it("si la lectura falla, reintenta y sigue recibiendo", async () => {
    const { cliente } = clienteConLotes([new Error("sin red"), new Error("sin red"), [act(7)]]);
    const log = logger();
    const manejadas: number[] = [];
    const p = await iniciarPolling({
      cliente,
      manejar: async (a) => void manejadas.push(a.update_id),
      logger: log,
      esperaErrorMs: 1,
    });
    await vi.waitFor(() => expect(manejadas).toEqual([7]));
    expect(log.warn).toHaveBeenCalledTimes(2);
    await p.detener();
  });

  it("detener() interrumpe la espera de Telegram y termina", async () => {
    const { cliente } = clienteConLotes([]);
    const p = await iniciarPolling({ cliente, manejar: async () => {}, logger: logger() });
    await expect(p.detener()).resolves.toBeUndefined();
  });

  it("los errores registrados no incluyen detalles internos del manejador", async () => {
    const { cliente } = clienteConLotes([[act(1, "/start secreto123")]]);
    const log = logger();
    const p = await iniciarPolling({
      cliente,
      manejar: async () => {
        throw new Error("boom");
      },
      logger: log,
    });
    await vi.waitFor(() => expect(log.error).toHaveBeenCalled());
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("secreto123");
    await p.detener();
  });
});
