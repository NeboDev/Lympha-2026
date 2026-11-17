import { describe, expect, it } from "vitest";
import type { Parametro, Reporte, Serie } from "../api/tipos.ts";
import { resumenLinea, vistaPrevia } from "./reportes-calculo.ts";

const ph: Parametro = {
  id: "ph",
  nombre: "pH",
  unidad: "",
  decimales: 1,
  norma: { min: 6.5, max: 8.5, fuente: "NOM-127-SSA1-2021" },
};

const serie = (puntos: Serie["puntos"]): Serie => ({
  desde: new Date(0),
  hasta: new Date(10_000),
  paso_s: 10,
  parametros: ["ph"],
  puntos,
});

describe("vistaPrevia", () => {
  it("promedia ponderando por las lecturas de cada tramo, y toma el mínimo y el máximo reales", () => {
    const v = vistaPrevia(
      serie([
        { ts: new Date(0), n: 3, v: { ph: { prom: 7, min: 6.5, max: 7.5 } } },
        { ts: new Date(1), n: 1, v: { ph: { prom: 8, min: 8, max: 8 } } },
      ]),
      "ph",
    );
    expect(v).toEqual({ promedio: 7.25, minimo: 6.5, maximo: 8, lecturas: 4 });
  });

  it("salta los tramos sin el parámetro y no inventa cifras si no hay datos", () => {
    const v = vistaPrevia(serie([{ ts: new Date(0), n: 5, v: {} }]), "ph");
    expect(v).toEqual({ promedio: null, minimo: null, maximo: null, lecturas: 0 });
    expect(vistaPrevia(serie([]), "ph").promedio).toBeNull();
  });
});

describe("resumenLinea", () => {
  const reporte = (resumen: Reporte["resumen"]): Reporte => ({
    id: "1",
    desde: new Date(0),
    hasta: new Date(1),
    generado: new Date(2),
    generado_por: "Ana",
    huella: "abcdef012345",
    resumen,
  });

  it("junta lo esencial en una línea", () => {
    const l = resumenLinea(
      reporte({
        parametros: { ph: { prom: 7.1, min: 6.4, max: 7.9, pct_en_rango: 97.24, n: 100 } },
        cobertura_pct: 94.4,
        alertas: 2,
      }),
      [ph],
    );
    expect(l).toBe("pH promedio 7.1 (6.4 a 7.9) · 97.2 % en rango · cobertura 94 % · 2 alertas");
  });

  it("sin datos de un parámetro lo omite; con una alerta usa el singular; sin alertas no la menciona", () => {
    const sin = resumenLinea(
      reporte({
        parametros: { ph: { prom: null, min: null, max: null, pct_en_rango: null, n: 0 } },
        cobertura_pct: 0,
        alertas: 0,
      }),
      [ph],
    );
    expect(sin).toBe("cobertura 0 %");
    const una = resumenLinea(reporte({ parametros: {}, cobertura_pct: 50, alertas: 1 }), [ph]);
    expect(una).toBe("cobertura 50 % · 1 alerta");
  });

  it("sin el % en rango (parámetro sin norma) no lo inventa", () => {
    const l = resumenLinea(
      reporte({
        parametros: { ph: { prom: 7, min: 7, max: 7, pct_en_rango: null, n: 3 } },
        cobertura_pct: 100,
        alertas: 0,
      }),
      [ph],
    );
    expect(l).not.toContain("en rango");
  });
});
