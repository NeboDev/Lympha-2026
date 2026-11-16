import { describe, expect, it } from "vitest";
import { calibrar2Puntos, fraccionHOCl, pendienteNernst, phDesdeMv, pKaHOCl } from "./ph.ts";

describe("Nernst", () => {
  it("≈ 59.16 mV/pH a 25 °C y crece con la temperatura", () => {
    expect(pendienteNernst(25)).toBeCloseTo(59.16, 1);
    expect(pendienteNernst(35)).toBeGreaterThan(pendienteNernst(25));
  });
});

describe("fracción de HOCl", () => {
  it("pKa ≈ 7.54 a 25 °C", () => {
    expect(pKaHOCl(25)).toBeCloseTo(7.54, 2);
  });

  // Valores de docs/cloracion-ph.md (calculados con la misma fórmula), tolerancia ±1 punto.
  it.each([
    [6.5, 25, 92],
    [7.0, 25, 77],
    [7.5, 25, 52],
    [8.0, 25, 26],
    [8.3, 25, 15],
    [8.5, 25, 10],
    [9.0, 25, 3],
    [7.5, 15, 58],
    [7.5, 30, 50],
  ])("pH %s a %s °C → ≈ %s %%", (ph, temp, esperado) => {
    expect(Math.abs(fraccionHOCl(ph, temp) * 100 - esperado)).toBeLessThanOrEqual(1);
  });

  it("decrece al subir el pH y vale 50 % cuando pH = pKa", () => {
    expect(fraccionHOCl(7, 25)).toBeGreaterThan(fraccionHOCl(8, 25));
    expect(fraccionHOCl(pKaHOCl(25), 25)).toBeCloseTo(0.5, 6);
  });

  it("siempre queda entre 0 y 1", () => {
    for (const ph of [0, 3, 7, 11, 14]) {
      const f = fraccionHOCl(ph, 25);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});

describe("calibración de 2 puntos", () => {
  const cal = calibrar2Puntos({ ph: 4, mv: 171 }, { ph: 7, mv: -3 }, 22);

  it("calcula pendiente, offset y % de Nernst", () => {
    expect(cal.pendienteMvPorPh).toBeCloseTo(-58, 6);
    expect(cal.offsetMv).toBeCloseTo(-3, 6);
    expect(cal.pendientePctNernst).toBeCloseTo((58 / pendienteNernst(22)) * 100, 6);
    expect(cal.pendientePctNernst).toBeGreaterThan(98);
  });

  it("reproduce los buffers de calibración", () => {
    expect(phDesdeMv(171, cal, 22)).toBeCloseTo(4, 6);
    expect(phDesdeMv(-3, cal, 22)).toBeCloseTo(7, 6);
  });

  it("compensa la temperatura: mismo mV, distinto pH", () => {
    const frio = phDesdeMv(100, cal, 22);
    const calido = phDesdeMv(100, cal, 40);
    expect(calido).not.toBeCloseTo(frio, 3);
  });

  it("una sonda desgastada baja el % de Nernst", () => {
    const vieja = calibrar2Puntos({ ph: 4, mv: 140 }, { ph: 7, mv: -3 }, 25);
    expect(vieja.pendientePctNernst).toBeLessThan(85);
  });

  it("rechaza puntos con el mismo pH", () => {
    expect(() => calibrar2Puntos({ ph: 7, mv: 0 }, { ph: 7, mv: 1 }, 25)).toThrow(/distintos/);
  });
});
