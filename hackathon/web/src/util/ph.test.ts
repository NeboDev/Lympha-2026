import { describe, expect, it } from "vitest";
import { DEGRADADO_PH, esPh, posicionPh } from "./ph.ts";

describe("posicionPh", () => {
  it("ubica el valor en la escala 0–14 y no se sale de los extremos", () => {
    expect(posicionPh(0)).toBe(0);
    expect(posicionPh(7)).toBe(50);
    expect(posicionPh(14)).toBe(100);
    expect(posicionPh(-3)).toBe(0);
    expect(posicionPh(20)).toBe(100);
    expect(posicionPh(Number.NaN)).toBe(0);
  });
});

describe("esPh y degradado", () => {
  it("solo «ph» es pH", () => {
    expect(esPh("ph")).toBe(true);
    expect(esPh("turbidez")).toBe(false);
  });

  it("el degradado va de ácido a neutro a básico en ese orden", () => {
    expect(DEGRADADO_PH).toBe(
      "var(--ph-acido) 28.6%, var(--ph-neutro) 50.0%, var(--ph-basico) 71.4%",
    );
  });
});
