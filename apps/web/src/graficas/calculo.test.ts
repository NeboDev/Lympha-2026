import { describe, expect, it } from "vitest";
import { calcularGrafica, type Dimensiones, escalaY, ticks } from "./calculo.ts";

const D: Dimensiones = {
  ancho: 300,
  alto: 100,
  margen: { arriba: 10, derecha: 10, abajo: 20, izquierda: 30 },
};

describe("escalaY", () => {
  it("deja aire alrededor del rango real (no parte de cero: un pH de 7 no se aplasta)", () => {
    const { yMin, yMax } = escalaY([7.0, 7.4]);
    expect(yMin).toBeLessThan(7.0);
    expect(yMax).toBeGreaterThan(7.4);
    expect(yMin).toBeGreaterThan(6);
  });

  it("una serie constante no da un rango de cero (no divide entre cero)", () => {
    const { yMin, yMax } = escalaY([7.2, 7.2, 7.2]);
    expect(yMax - yMin).toBeGreaterThan(0);
    expect(escalaY([0, 0]).yMax).toBeGreaterThan(0);
  });

  it("datos no negativos nunca dan un eje negativo (una turbidez de 0.45 no baja de cero)", () => {
    expect(escalaY([0.45, 0.45]).yMin).toBe(0);
    expect(escalaY([0.1, 0.3]).yMin).toBeGreaterThanOrEqual(0);
    expect(escalaY([0, 4]).yMin).toBe(0);
  });

  it("con datos negativos el eje sí los alcanza", () => {
    expect(escalaY([-2, 3]).yMin).toBeLessThan(-2);
  });

  it("sin datos devuelve una escala válida", () => {
    expect(escalaY([])).toEqual({ yMin: 0, yMax: 1 });
  });
});

describe("ticks", () => {
  it("reparte valores equiespaciados con los extremos incluidos", () => {
    expect(ticks(0, 10, 3)).toEqual([0, 5, 10]);
    expect(ticks(4, 4, 1)).toEqual([4]);
  });
});

describe("calcularGrafica", () => {
  it("una serie continua da un solo trazo dentro del área de dibujo", () => {
    const g = calcularGrafica(
      [
        { x: 0, y: 1 },
        { x: 10, y: 3 },
        { x: 20, y: 2 },
      ],
      D,
    );
    expect(g.trazos).toHaveLength(1);
    expect(g.trazos[0]).toMatch(/^M30 /); // empieza en el margen izquierdo
    const coordenadas = [...(g.trazos[0] ?? "").matchAll(/[ML]([\d.]+) ([\d.]+)/g)];
    for (const [, x, y] of coordenadas) {
      expect(Number(x)).toBeGreaterThanOrEqual(30);
      expect(Number(x)).toBeLessThanOrEqual(290);
      expect(Number(y)).toBeGreaterThanOrEqual(10);
      expect(Number(y)).toBeLessThanOrEqual(80);
    }
  });

  it("un valor mayor queda MÁS ARRIBA (y menor en SVG)", () => {
    const g = calcularGrafica(
      [
        { x: 0, y: 1 },
        { x: 10, y: 9 },
      ],
      D,
    );
    const ys = [...(g.trazos[0] ?? "").matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(ys).toHaveLength(2);
    expect(ys[1]).toBeLessThan(ys[0] as number);
  });

  it("un hueco corta la línea en vez de unir puntos que no se midieron", () => {
    const g = calcularGrafica(
      [
        { x: 0, y: 1 },
        { x: 1, y: 2 },
        { x: 2, y: null },
        { x: 3, y: 2 },
        { x: 4, y: 3 },
      ],
      D,
    );
    expect(g.trazos).toHaveLength(2);
  });

  it("un tramo de un solo dato se dibuja como punto", () => {
    const g = calcularGrafica(
      [
        { x: 0, y: 1 },
        { x: 1, y: null },
        { x: 2, y: 5 },
        { x: 3, y: null },
        { x: 4, y: 2 },
        { x: 5, y: 3 },
      ],
      D,
    );
    expect(g.aislados).toHaveLength(2);
    expect(g.trazos).toHaveLength(1);
  });

  it("ordena puntos desordenados por x", () => {
    const a = calcularGrafica(
      [
        { x: 10, y: 3 },
        { x: 0, y: 1 },
      ],
      D,
    );
    const b = calcularGrafica(
      [
        { x: 0, y: 1 },
        { x: 10, y: 3 },
      ],
      D,
    );
    expect(a.trazos).toEqual(b.trazos);
  });

  it("un solo punto se centra y no revienta con ancho cero en x", () => {
    const g = calcularGrafica([{ x: 5, y: 2 }], D);
    expect(g.aislados).toEqual([{ cx: 160, cy: expect.any(Number) }]);
    expect(g.resumen).toEqual({ minimo: 2, maximo: 2, ultimo: 2, n: 1 });
  });

  it("sin datos no hay trazos ni resumen", () => {
    const g = calcularGrafica([{ x: 0, y: null }], D);
    expect(g.trazos).toEqual([]);
    expect(g.resumen).toBeNull();
  });

  it("el resumen toma mínimo, máximo y el último valor con dato", () => {
    const g = calcularGrafica(
      [
        { x: 0, y: 5 },
        { x: 1, y: 2 },
        { x: 2, y: 9 },
        { x: 3, y: null },
      ],
      D,
    );
    expect(g.resumen).toEqual({ minimo: 2, maximo: 9, ultimo: 9, n: 3 });
  });
});
