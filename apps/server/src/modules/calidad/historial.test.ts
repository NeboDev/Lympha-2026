import type { ConteoNiveles } from "@lympha/contracts";
import { describe, expect, it } from "vitest";
import { nivelPredominante } from "./historial.ts";

const conteo = (c: Partial<ConteoNiveles>): ConteoNiveles => ({
  buena: 0,
  regular: 0,
  mala: 0,
  critica: 0,
  sin_datos: 0,
  ...c,
});

describe("nivelPredominante (RF-35)", () => {
  it("gana el nivel más frecuente", () => {
    expect(nivelPredominante(conteo({ buena: 900, regular: 100, mala: 5 }))).toBe("buena");
    expect(nivelPredominante(conteo({ buena: 10, regular: 700, mala: 20 }))).toBe("regular");
  });

  it("en empate gana el peor nivel", () => {
    expect(nivelPredominante(conteo({ buena: 50, regular: 50 }))).toBe("regular");
    expect(nivelPredominante(conteo({ buena: 3, mala: 3, critica: 3 }))).toBe("critica");
  });

  it("sin_datos no cuenta cuando hay evaluaciones con dato", () => {
    expect(nivelPredominante(conteo({ buena: 1, sin_datos: 500 }))).toBe("buena");
  });

  it("solo es sin_datos si todo el día lo fue (o no hay evaluaciones)", () => {
    expect(nivelPredominante(conteo({ sin_datos: 40 }))).toBe("sin_datos");
    expect(nivelPredominante(conteo({}))).toBe("sin_datos");
  });
});
