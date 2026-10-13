import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluarEscenario, leerEscenario } from "./escenarios.ts";

const e = leerEscenario({
  nombre: "prueba",
  pasos: [
    { duracionS: 100, ph: 7.2 },
    { duracionS: 100, ph: { de: 7.2, a: 5.2 }, turb: null },
    { duracionS: 50, desconectado: true },
  ],
});

describe("escenarios", () => {
  it("valor fijo, rampa lineal y sensor caído", () => {
    expect(evaluarEscenario(e, 0).valores).toEqual({ ph: 7.2 });
    expect(evaluarEscenario(e, 150).valores.ph).toBeCloseTo(6.2);
    expect(evaluarEscenario(e, 150).valores.turb).toBeNull();
    expect(evaluarEscenario(e, 100).valores.ph).toBeCloseTo(7.2);
  });

  it("un paso de desconexión marca al nodo como caído", () => {
    expect(evaluarEscenario(e, 210).desconectado).toBe(true);
    expect(evaluarEscenario(e, 199).desconectado).toBe(false);
  });

  it("al terminar queda inactivo, o repite si se pidió", () => {
    expect(evaluarEscenario(e, 250).activo).toBe(false);
    const r = leerEscenario({ ...e, repetir: true });
    expect(evaluarEscenario(r, 250 + 10).valores).toEqual({ ph: 7.2 });
    expect(evaluarEscenario(r, 260).activo).toBe(true);
  });

  it("rechaza escenarios mal formados", () => {
    expect(() => leerEscenario({ nombre: "x", pasos: [] })).toThrow();
    expect(() => leerEscenario({ nombre: "x", pasos: [{ duracionS: 0 }] })).toThrow();
    expect(() => leerEscenario({ nombre: "x", pasos: [{ duracionS: 1, ph: "7" }] })).toThrow();
    expect(() => leerEscenario({ nombre: "x", pasos: [{ duracionS: 1, otro: 1 }] })).toThrow();
  });

  it("todos los escenarios incluidos son válidos", () => {
    const dir = join(import.meta.dirname, "..", "escenarios");
    const archivos = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(archivos.length).toBeGreaterThanOrEqual(4);
    for (const f of archivos) {
      expect(() => leerEscenario(JSON.parse(readFileSync(join(dir, f), "utf8"))), f).not.toThrow();
    }
  });
});
