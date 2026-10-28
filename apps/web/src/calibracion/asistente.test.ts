import type { LecturaApi } from "@lympha/contracts";
import { describe, expect, it } from "vitest";
import {
  type AccionAsistente,
  estadoInicial,
  puedeTerminar,
  reducirAsistente,
} from "./asistente.ts";
import { anclaDe, lecturasCrudas, numeroCal, vistaPrevia } from "./utilidades.ts";

const correr = (...acciones: AccionAsistente[]) => acciones.reduce(reducirAsistente, estadoInicial);

describe("asistente", () => {
  it("elegir un parámetro carga la guía y empieza en preparar", () => {
    const e = correr({ tipo: "elegir", parametro: "ph" });
    expect(e.fase).toBe("punto");
    expect(e.momento).toBe("preparar");
    expect(e.referencias).toEqual([7, 4, 10]);
  });

  it("no se puede capturar sin haber empezado a medir", () => {
    const e = correr({ tipo: "elegir", parametro: "ph" }, { tipo: "capturar", crudo: 6.9 });
    expect(e.capturados).toEqual([]);
  });

  it("recorre los puntos; el opcional se puede dejar y pasar al resumen", () => {
    let e = correr(
      { tipo: "elegir", parametro: "ph" },
      { tipo: "medir", ancla: "t0" },
      { tipo: "capturar", crudo: 6.8 },
    );
    expect(e.indice).toBe(1);
    expect(e.momento).toBe("preparar");
    expect(e.ancla).toBeNull();
    expect(puedeTerminar(e)).toBe(false);
    e = [
      { tipo: "medir", ancla: "t1" },
      { tipo: "capturar", crudo: 3.9 },
    ].reduce(reducirAsistente as (s: typeof e, a: unknown) => typeof e, e);
    expect(e.fase).toBe("punto");
    expect(e.indice).toBe(2); // pH 10, opcional
    expect(puedeTerminar(e)).toBe(true);
    e = reducirAsistente(e, { tipo: "terminar" });
    expect(e.fase).toBe("resumen");
    expect(e.capturados.map((c) => [c.referencia, c.crudo])).toEqual([
      [7, 6.8],
      [4, 3.9],
    ]);
  });

  it("usa el valor real del patrón que la persona corrigió", () => {
    const e = correr(
      { tipo: "elegir", parametro: "conductividad" },
      { tipo: "referencia", indice: 1, valor: 1500 },
      { tipo: "medir", ancla: null },
      { tipo: "capturar", crudo: 2 },
      { tipo: "medir", ancla: null },
      { tipo: "capturar", crudo: 1450 },
    );
    expect(e.fase).toBe("resumen");
    expect(e.capturados.at(-1)?.referencia).toBe(1500);
  });

  it("repetir un punto lo descarta y vuelve a prepararlo", () => {
    const e = correr(
      { tipo: "elegir", parametro: "turbidez" },
      { tipo: "medir", ancla: null },
      { tipo: "capturar", crudo: 0.4 },
      { tipo: "repetir", indice: 0 },
    );
    expect(e.capturados).toEqual([]);
    expect(e.indice).toBe(0);
    expect(e.momento).toBe("preparar");
  });
});

const lectura = (ts: string, ph: number | null, crudo?: number): LecturaApi => ({
  nodo_id: "n",
  ts,
  seq: 1,
  ph,
  temperatura: 20,
  conductividad: null,
  turbidez: null,
  tds: null,
  ...(crudo !== undefined ? { crudo: { ph: crudo } } : {}),
});

describe("lecturas crudas", () => {
  const lecturas = [
    lectura("2026-01-01T00:03:00Z", 7.3, 7.1),
    lectura("2026-01-01T00:02:00Z", 7.2),
    lectura("2026-01-01T00:01:00Z", null),
    lectura("2026-01-01T00:00:00Z", 6.0),
  ];

  it("usa el crudo guardado, ignora las lecturas sin valor y ordena de antigua a reciente", () => {
    expect(lecturasCrudas(lecturas, "ph", null).map((l) => l.valor)).toEqual([6.0, 7.2, 7.1]);
  });

  it("solo cuenta lo posterior al ancla (la hora del nodo)", () => {
    expect(lecturasCrudas(lecturas, "ph", "2026-01-01T00:01:00Z").map((l) => l.valor)).toEqual([
      7.2, 7.1,
    ]);
    expect(anclaDe(lecturas)).toBe("2026-01-01T00:03:00Z");
    expect(anclaDe([])).toBeNull();
  });
});

describe("vistaPrevia y formato", () => {
  it("calcula el valor calibrado y el error de cada punto", () => {
    const filas = vistaPrevia(
      [
        { crudo: 6, referencia: 7 },
        { crudo: 3, referencia: 4.2 },
      ],
      { pendiente: 1, desfase: 1 },
    );
    expect(filas[0]).toEqual({ referencia: 7, crudo: 6, calibrado: 7, error: 0 });
    expect(filas[1]?.error).toBeCloseTo(-0.2, 10);
  });

  it("da números cortos", () => {
    expect(numeroCal(1.034482758)).toBe("1.034");
    expect(numeroCal(Number.NaN)).toBe("—");
  });
});

describe("tipoSolucion", () => {
  it("elige el color del patrón según el parámetro y el valor real", async () => {
    const { tipoSolucion } = await import("./utilidades.ts");
    expect(tipoSolucion("ph", 4.01)).toBe("ph4");
    expect(tipoSolucion("ph", 7)).toBe("ph7");
    expect(tipoSolucion("ph", 10)).toBe("ph10");
    expect(tipoSolucion("conductividad", 0)).toBe("destilada");
    expect(tipoSolucion("tds", 706)).toBe("conductividad");
    expect(tipoSolucion("turbidez", 100)).toBe("turbidez");
  });
});
