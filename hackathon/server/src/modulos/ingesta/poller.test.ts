import { describe, expect, it, vi } from "vitest";
import { BaseFalsa, nodoDePrueba } from "../../test/falsos.ts";
import { crearPoller } from "./index.ts";

describe("poller con la espera real", () => {
  it("detener() justo después de iniciar() no espera todo el intervalo", async () => {
    const base = new BaseFalsa();
    base.agregarNodo(nodoDePrueba());
    const ciclo = vi.fn(async () => ({
      tipo: "sin_cambio" as const,
      sinDatos: false,
      pendientes: 0,
    }));
    const poller = crearPoller({ ingesta: { ciclo }, almacen: base, pollMs: 60_000 });
    poller.iniciar();
    const inicio = Date.now();
    await poller.detener();
    expect(Date.now() - inicio).toBeLessThan(1000);
  });

  it("sigue sondeando mientras no se detenga", async () => {
    const base = new BaseFalsa();
    base.agregarNodo(nodoDePrueba());
    const ciclo = vi.fn(async () => ({
      tipo: "sin_cambio" as const,
      sinDatos: false,
      pendientes: 0,
    }));
    const poller = crearPoller({ ingesta: { ciclo }, almacen: base, pollMs: 5 });
    poller.iniciar();
    await vi.waitFor(() => expect(ciclo.mock.calls.length).toBeGreaterThanOrEqual(3));
    await poller.detener();
  });
});
