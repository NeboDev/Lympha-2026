import { describe, expect, it } from "vitest";
import { efectividadCloroPct, fraccionHOCl, pKaHOCl } from "./cloro.ts";

describe("cloro", () => {
  it("el pKa a 25 °C es ≈ 7.54", () => {
    expect(pKaHOCl(25)).toBeCloseTo(7.54, 1);
  });

  it("a pH 7 más de la mitad es HOCl; a pH 8.3 solo ~15 %", () => {
    expect(fraccionHOCl(7, 25)).toBeGreaterThan(0.5);
    expect(efectividadCloroPct(8.3)).toBe(15);
    expect(efectividadCloroPct(7)).toBe(77);
  });

  it("baja al subir el pH y depende de la temperatura", () => {
    expect(efectividadCloroPct(6.5) ?? 0).toBeGreaterThan(efectividadCloroPct(7.5) ?? 0);
    expect(efectividadCloroPct(7.8, 15) ?? 0).toBeGreaterThan(efectividadCloroPct(7.8, 25) ?? 0);
  });

  it("no inventa un porcentaje con un pH imposible o ausente", () => {
    for (const ph of [null, undefined, Number.NaN, -1, 15])
      expect(efectividadCloroPct(ph)).toBeNull();
  });
});
