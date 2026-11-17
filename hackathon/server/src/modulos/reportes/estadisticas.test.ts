import { describe, expect, it } from "vitest";
import { estadisticasParametro, serieGrafica } from "./estadisticas.ts";
import type { MuestraReporte } from "./puertos.ts";

const T0 = Date.UTC(2026, 10, 19, 15, 0, 0);
const en = (s: number) => new Date(T0 + s * 1000);
const m = (s: number, ph: number, estado?: "en_rango" | "fuera_de_rango"): MuestraReporte => ({
  ts: en(s),
  v: { ph },
  ...(estado ? { estados: { ph: estado } } : {}),
});
const NORMA = { min: 6.5, max: 8.5 };

describe("estadisticasParametro", () => {
  it("calcula promedio, mínimo, máximo y n", () => {
    const r = estadisticasParametro([m(0, 7), m(10, 8), m(20, 6)], "ph", NORMA, en(0), en(30), 60);
    expect(r.n).toBe(3);
    expect(r.promedio).toBeCloseTo(7);
    expect(r.minimo).toBe(6);
    expect(r.maximo).toBe(8);
  });

  it("el % en rango pesa por el tiempo que cubre cada muestra, no por su número", () => {
    // 7.0 cubre 30 s (en rango); 6.0 cubre 10 s (fuera): 75 % del tiempo en rango.
    const r = estadisticasParametro([m(0, 7), m(30, 6)], "ph", NORMA, en(0), en(40), 60);
    expect(r.pctEnRango).toBeCloseTo(75);
    expect(r.segundosConDatos).toBe(40);
    expect(r.coberturaPct).toBeCloseTo(100);
  });

  it("los límites son inclusivos", () => {
    const r = estadisticasParametro([m(0, 6.5), m(10, 8.5)], "ph", NORMA, en(0), en(20), 60);
    expect(r.pctEnRango).toBeCloseTo(100);
  });

  it("un tramo más largo que el hueco máximo es un hueco: no cuenta como dato", () => {
    // Datos de 0 a 10 s, silencio hasta 100 s, y otra muestra que cubre 10 s.
    const r = estadisticasParametro(
      [m(0, 7), m(10, 7), m(100, 7)],
      "ph",
      NORMA,
      en(0),
      en(110),
      20,
    );
    expect(r.huecos).toBe(1);
    expect(r.huecoMayorS).toBe(90);
    // 10 + 20 (tope de la muestra de 10 s) + 10 = 40 s de 110 s.
    expect(r.segundosConDatos).toBe(40);
    expect(r.coberturaPct).toBeCloseTo((40 / 110) * 100);
  });

  it("el hueco al inicio y al final del periodo también cuenta", () => {
    const r = estadisticasParametro([m(50, 7)], "ph", NORMA, en(0), en(200), 20);
    expect(r.huecos).toBe(2);
    expect(r.huecoMayorS).toBe(150);
  });

  it("sin muestras: todo el periodo es un hueco y no se inventa nada", () => {
    const r = estadisticasParametro([], "ph", NORMA, en(0), en(100), 20);
    expect(r).toMatchObject({
      n: 0,
      promedio: null,
      minimo: null,
      maximo: null,
      pctEnRango: null,
      coberturaPct: 0,
      huecos: 1,
      huecoMayorS: 100,
    });
  });

  it("ignora muestras fuera del periodo o sin el parámetro", () => {
    const otras: MuestraReporte[] = [
      m(-5, 99),
      { ts: en(5), v: {} },
      { ts: en(6), v: { ph: Number.NaN } },
      m(8, 7),
      m(500, 99),
    ];
    const r = estadisticasParametro(otras, "ph", NORMA, en(0), en(20), 60);
    expect(r.n).toBe(1);
    expect(r.promedio).toBe(7);
  });

  it("sin límites no hay % en rango", () => {
    const r = estadisticasParametro([m(0, 7)], "ph", null, en(0), en(10), 60);
    expect(r.pctEnRango).toBeNull();
    expect(r.promedio).toBe(7);
  });

  it("suma el tiempo por estado evaluado", () => {
    const r = estadisticasParametro(
      [m(0, 7, "en_rango"), m(30, 6, "fuera_de_rango")],
      "ph",
      NORMA,
      en(0),
      en(40),
      60,
    );
    expect(r.segundosPorEstado).toEqual({ en_rango: 30, fuera_de_rango: 10 });
  });

  it("un periodo vacío no divide entre cero", () => {
    const r = estadisticasParametro([], "ph", NORMA, en(0), en(0), 60);
    expect(r.coberturaPct).toBe(0);
    expect(r.huecos).toBe(0);
  });
});

describe("serieGrafica", () => {
  it("promedia por tramo y deja null donde no hubo muestras", () => {
    const s = serieGrafica([m(1, 7), m(2, 9), m(31, 5)], "ph", en(0), en(40), 4);
    // Tramos de 10 s: [0,10) → 8, [10,20) → hueco, [20,30) → hueco, [30,40] → 5.
    expect(s).toEqual([8, null, null, 5]);
  });

  it("una muestra justo en el borde final cae en el último tramo", () => {
    const s = serieGrafica([m(40, 7)], "ph", en(0), en(40), 4);
    expect(s).toEqual([null, null, null, 7]);
  });

  it("un periodo sin duración da solo huecos", () => {
    expect(serieGrafica([m(0, 7)], "ph", en(0), en(0), 3)).toEqual([null, null, null]);
  });
});
