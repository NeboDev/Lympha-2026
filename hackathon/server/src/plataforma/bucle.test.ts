import { describe, expect, it, vi } from "vitest";
import { crearBucle } from "./bucle.ts";

describe("crearBucle", () => {
  it("repite la tarea cada intervalo y se detiene", async () => {
    const tarea = vi.fn(async () => {});
    const b = crearBucle("prueba", tarea, 5, { warn: vi.fn() });
    b.iniciar();
    await vi.waitFor(() => expect(tarea.mock.calls.length).toBeGreaterThanOrEqual(3));
    await b.detener();
    const n = tarea.mock.calls.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(tarea.mock.calls.length).toBe(n);
  });

  it("nunca corre dos pasadas a la vez", async () => {
    let enCurso = 0;
    let maximo = 0;
    const b = crearBucle(
      "solape",
      async () => {
        enCurso++;
        maximo = Math.max(maximo, enCurso);
        await new Promise((r) => setTimeout(r, 15));
        enCurso--;
      },
      1,
      { warn: vi.fn() },
    );
    b.iniciar();
    await new Promise((r) => setTimeout(r, 80));
    await b.detener();
    expect(maximo).toBe(1);
  });

  it("un error se registra y el bucle sigue", async () => {
    const warn = vi.fn();
    let n = 0;
    const b = crearBucle(
      "falla",
      async () => {
        n++;
        if (n === 1) throw new Error("boom");
      },
      5,
      { warn },
    );
    b.iniciar();
    await vi.waitFor(() => expect(n).toBeGreaterThanOrEqual(3));
    await b.detener();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ bucle: "falla", causa: "boom" });
  });

  it("detener() interrumpe la espera: no tarda lo que dura el intervalo", async () => {
    const b = crearBucle("largo", async () => {}, 60_000, { warn: vi.fn() });
    b.iniciar();
    const inicio = Date.now();
    await b.detener();
    expect(Date.now() - inicio).toBeLessThan(1000);
  });

  it("iniciar dos veces no crea dos bucles", async () => {
    const tarea = vi.fn(async () => {});
    const b = crearBucle("doble", tarea, 60_000, { warn: vi.fn() });
    b.iniciar();
    b.iniciar();
    await vi.waitFor(() => expect(tarea).toHaveBeenCalledTimes(1));
    await b.detener();
    expect(tarea).toHaveBeenCalledTimes(1);
  });
});
