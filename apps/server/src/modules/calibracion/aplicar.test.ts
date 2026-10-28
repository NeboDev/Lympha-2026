import { describe, expect, it } from "vitest";
import { type CoeficientesNodo, calibrarFilas, type FilaCalibrable } from "./aplicar.ts";

const fila = (nodoId: string, extra: Partial<FilaCalibrable> = {}): FilaCalibrable => ({
  nodoId,
  ph: 6,
  conductividad: 500,
  tds: 250,
  turbidez: 2,
  ...extra,
});

const nodo = (c: Record<string, [number, number]>): CoeficientesNodo =>
  new Map(
    Object.entries(c).map(([p, [pendiente, desfase]]) => [p as "ph", { pendiente, desfase }]),
  );

describe("calibrarFilas", () => {
  it("corrige solo los parámetros calibrados y guarda su valor crudo", () => {
    const [f] = calibrarFilas(
      [fila("a")],
      new Map([["a", nodo({ ph: [1, 1], conductividad: [2, 10] })]]),
    );
    expect(f?.ph).toBe(7);
    expect(f?.conductividad).toBe(1010);
    expect(f?.tds).toBe(250);
    expect(f?.turbidez).toBe(2);
    expect(f?.crudo).toEqual({ ph: 6, conductividad: 500 });
  });

  it("no muta las filas de entrada (un lote reintentado no se calibra dos veces)", () => {
    const original = fila("a");
    const coef = new Map([["a", nodo({ ph: [1, 1] })]]);
    calibrarFilas([original], coef);
    expect(original.ph).toBe(6);
    expect(original.crudo).toBeUndefined();
    expect(calibrarFilas([original], coef)[0]?.ph).toBe(7);
  });

  it("deja pasar nodos sin calibración, valores ausentes y la identidad", () => {
    const filas = [fila("sin"), fila("a", { ph: null }), fila("id")];
    const out = calibrarFilas(
      filas,
      new Map([
        ["a", nodo({ ph: [1, 1] })],
        ["id", nodo({ ph: [1, 0] })],
      ]),
    );
    expect(out[0]).toBe(filas[0]);
    expect(out[1]?.ph).toBeNull();
    expect(out[1]?.crudo).toBeUndefined();
    expect(out[2]?.ph).toBe(6);
    expect(out[2]?.crudo).toBeUndefined();
  });

  it("cada nodo usa sus propios coeficientes", () => {
    const out = calibrarFilas(
      [fila("a"), fila("b")],
      new Map([
        ["a", nodo({ ph: [1, 1] })],
        ["b", nodo({ ph: [2, 0] })],
      ]),
    );
    expect(out.map((f) => f.ph)).toEqual([7, 12]);
  });
});
