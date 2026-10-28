import { describe, expect, it } from "vitest";
import {
  advertencias,
  aplicarCalibracion,
  calcularRegresion,
  ErrorCalibracion,
  evaluarEstabilidad,
  GUIA_CALIBRACION,
  IDENTIDAD,
  PARAMETROS_CALIBRABLES,
} from "./index.ts";

describe("calcularRegresion", () => {
  it("dos puntos dan una recta exacta", () => {
    const r = calcularRegresion([
      { crudo: 6.8, referencia: 7 },
      { crudo: 3.9, referencia: 4 },
    ]);
    expect(r.pendiente).toBeCloseTo(3 / 2.9, 10);
    expect(aplicarCalibracion(6.8, r)).toBeCloseTo(7, 10);
    expect(aplicarCalibracion(3.9, r)).toBeCloseTo(4, 10);
    expect(r.r2).toBeCloseTo(1, 10);
    expect(r.puntos).toBe(2);
  });

  it("recupera pendiente y desfase de datos sin ruido", () => {
    const puntos = [4, 7, 10].map((referencia) => ({
      referencia,
      crudo: (referencia - 0.3) / 0.9,
    }));
    const r = calcularRegresion(puntos);
    expect(r.pendiente).toBeCloseTo(0.9, 10);
    expect(r.desfase).toBeCloseTo(0.3, 10);
    expect(r.r2).toBeCloseTo(1, 10);
  });

  it("con ruido ajusta por mínimos cuadrados y R² baja", () => {
    const r = calcularRegresion([
      { crudo: 1, referencia: 1.1 },
      { crudo: 2, referencia: 1.9 },
      { crudo: 3, referencia: 3.2 },
      { crudo: 4, referencia: 3.8 },
    ]);
    expect(r.pendiente).toBeCloseTo(0.94, 10);
    expect(r.desfase).toBeCloseTo(0.15, 10);
    expect(r.r2).toBeGreaterThan(0.98);
    expect(r.r2).toBeLessThan(1);
  });

  it("rechaza menos de dos puntos, puntos sin variación y valores no numéricos", () => {
    const codigo = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return e instanceof ErrorCalibracion ? e.codigo : "otro";
      }
      return "sin error";
    };
    expect(codigo(() => calcularRegresion([{ crudo: 1, referencia: 1 }]))).toBe(
      "puntos_insuficientes",
    );
    expect(
      codigo(() =>
        calcularRegresion([
          { crudo: 5, referencia: 4 },
          { crudo: 5, referencia: 7 },
        ]),
      ),
    ).toBe("puntos_repetidos");
    expect(
      codigo(() =>
        calcularRegresion([
          { crudo: Number.NaN, referencia: 4 },
          { crudo: 5, referencia: 7 },
        ]),
      ),
    ).toBe("valor_invalido");
  });

  it("rechaza una respuesta invertida", () => {
    expect(() =>
      calcularRegresion([
        { crudo: 7, referencia: 4 },
        { crudo: 4, referencia: 7 },
      ]),
    ).toThrow(/al revés/);
  });
});

describe("advertencias", () => {
  it("avisa de una pendiente atípica y de un R² bajo con 3 o más puntos", () => {
    expect(advertencias({ pendiente: 1.1, desfase: 0, r2: 0.999, puntos: 3 })).toEqual([]);
    expect(advertencias({ pendiente: 3, desfase: 0, r2: 1, puntos: 2 })).toEqual([
      "pendiente_atipica",
    ]);
    expect(advertencias({ pendiente: 1, desfase: 0, r2: 0.9, puntos: 3 })).toEqual(["r2_bajo"]);
    // con dos puntos R² es siempre 1: no se evalúa
    expect(advertencias({ pendiente: 1, desfase: 0, r2: 0.5, puntos: 2 })).toEqual([]);
  });
});

describe("aplicarCalibracion", () => {
  it("aplica la recta, deja pasar los nulos y la identidad no cambia nada", () => {
    expect(aplicarCalibracion(10, { pendiente: 2, desfase: 1 })).toBe(21);
    expect(aplicarCalibracion(null, { pendiente: 2, desfase: 1 })).toBeNull();
    expect(aplicarCalibracion(7.123, IDENTIDAD)).toBe(7.123);
  });
});

describe("evaluarEstabilidad", () => {
  it("no es estable sin la ventana completa", () => {
    const e = evaluarEstabilidad("ph", [7.0, 7.01, 7.0]);
    expect(e.estable).toBe(false);
    expect(e.disponibles).toBe(3);
    expect(e.necesarias).toBe(8);
  });

  it("es estable cuando las últimas lecturas varían poco", () => {
    const e = evaluarEstabilidad("ph", [9, 8, 7.01, 7.0, 7.02, 7.01, 7.0, 7.02, 7.01, 7.0]);
    expect(e.estable).toBe(true);
    expect(e.promedio).toBeCloseTo(7.01, 2);
  });

  it("solo cuenta la ventana final: un arranque inestable no estorba", () => {
    const valores = [3, 9, 5, 7.0, 7.0, 7.0, 7.0, 7.0, 7.0, 7.0, 7.0];
    expect(evaluarEstabilidad("ph", valores).estable).toBe(true);
  });

  it("no es estable si una lectura se sale del umbral", () => {
    const e = evaluarEstabilidad("ph", [7.0, 7.0, 7.0, 7.0, 7.0, 7.0, 7.0, 7.4]);
    expect(e.estable).toBe(false);
    expect(e.desviacion).toBeGreaterThan(e.umbral ?? 0);
  });

  it("el umbral crece con la escala en conductividad (relativo)", () => {
    const base = [1410, 1415, 1412, 1418, 1411, 1414, 1413, 1416];
    expect(evaluarEstabilidad("conductividad", base).estable).toBe(true);
    expect(
      evaluarEstabilidad("conductividad", [1000, 1400, 1000, 1400, 1000, 1400, 1000, 1400]).estable,
    ).toBe(false);
  });

  it("ignora valores no finitos y no revienta sin lecturas", () => {
    expect(evaluarEstabilidad("tds", []).promedio).toBeNull();
    expect(evaluarEstabilidad("tds", [Number.NaN, 5]).disponibles).toBe(1);
  });
});

describe("GUIA_CALIBRACION", () => {
  it("cubre todos los parámetros y pide al menos dos pasos obligatorios", () => {
    for (const p of PARAMETROS_CALIBRABLES) {
      const g = GUIA_CALIBRACION[p];
      expect(g.pasos.filter((x) => !x.opcional).length).toBeGreaterThanOrEqual(g.minimo);
    }
  });
});
