import { telemetria } from "@lympha/contracts";
import { describe, expect, it } from "vitest";
import { crearModeloAgua } from "./nodo.ts";

describe("crearModeloAgua", () => {
  it("genera mediciones válidas según el contrato y dentro de rangos razonables", () => {
    const modelo = crearModeloAgua(42);
    for (let i = 0; i < 500; i++) {
      const m = modelo.siguiente();
      expect(telemetria.safeParse({ v: 1, ts: 1760150400 + i, seq: i, ...m }).success).toBe(true);
      expect(m.ph).toBeGreaterThanOrEqual(6);
      expect(m.ph).toBeLessThanOrEqual(8.5);
      expect(m.turb).toBeGreaterThanOrEqual(0);
    }
  });

  it("es determinista para una misma semilla", () => {
    const a = crearModeloAgua(7);
    const b = crearModeloAgua(7);
    expect([a.siguiente(), a.siguiente()]).toEqual([b.siguiente(), b.siguiente()]);
  });
});
