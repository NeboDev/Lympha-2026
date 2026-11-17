import { describe, expect, it } from "vitest";
import type { Serie } from "../api/tipos.ts";
import {
  descripcionGrafica,
  dominioY,
  escala,
  marcasX,
  marcasY,
  type PuntoGrafica,
  puntosDe,
  tramos,
} from "./calculo.ts";

const p = (t: number, prom: number, min = prom, max = prom): PuntoGrafica => ({
  t,
  prom,
  min,
  max,
});

describe("puntosDe", () => {
  it("toma solo el parámetro pedido y salta los tramos que no lo traen", () => {
    const serie: Serie = {
      desde: new Date(0),
      hasta: new Date(3000),
      paso_s: 1,
      parametros: ["ph"],
      puntos: [
        { ts: new Date(1000), n: 2, v: { ph: { prom: 7, min: 6.9, max: 7.1 } } },
        { ts: new Date(2000), n: 1, v: {} },
        { ts: new Date(3000), n: 1, v: { ph: { prom: 7.2, min: 7.2, max: 7.2 } } },
      ],
    };
    expect(puntosDe(serie, "ph")).toEqual([p(1000, 7, 6.9, 7.1), p(3000, 7.2)]);
    expect(puntosDe(serie, "turbidez")).toEqual([]);
  });
});

describe("dominioY", () => {
  it("contiene los datos y la franja de la norma, con aire", () => {
    const [lo, hi] = dominioY([p(0, 7, 6.8, 7.2)], { min: 6.5, max: 8.5 });
    expect(lo).toBeLessThan(6.5);
    expect(hi).toBeGreaterThan(8.5);
  });

  it("si los datos salen de la norma, también los contiene", () => {
    const [lo, hi] = dominioY([p(0, 5.2), p(1, 9.6)], { min: 6.5, max: 8.5 });
    expect(lo).toBeLessThan(5.2);
    expect(hi).toBeGreaterThan(9.6);
  });

  it("sin datos ni norma usa 0–14; con un solo valor no se aplasta", () => {
    expect(dominioY([], null)).toEqual([0, 14]);
    const [lo, hi] = dominioY([p(0, 7)], null);
    expect(hi - lo).toBeGreaterThanOrEqual(0.5);
  });

  it("una norma abierta de un lado no rompe nada", () => {
    const [lo, hi] = dominioY([p(0, 2)], { min: null, max: 4 });
    expect(Number.isFinite(lo) && Number.isFinite(hi)).toBe(true);
    expect(hi).toBeGreaterThan(4);
  });
});

describe("marcasY y escala", () => {
  it("las marcas son redondas y caben en el rango", () => {
    expect(marcasY(5.7, 9.3)).toEqual([6, 7, 8, 9]);
    const m = marcasY(0.1, 0.9);
    expect(m.length).toBeGreaterThan(1);
    expect(m.length).toBeLessThanOrEqual(7);
  });

  it("escala lineal y centrada cuando el dominio no tiene ancho", () => {
    const y = escala(0, 10, 100, 0); // el eje Y crece hacia arriba: píxeles invertidos
    expect(y(0)).toBe(100);
    expect(y(10)).toBe(0);
    expect(y(5)).toBe(50);
    expect(escala(3, 3, 0, 10)(3)).toBe(5);
  });
});

describe("tramos", () => {
  it("corta la línea donde hay un hueco, sin unir los dos lados", () => {
    const pts = [p(0, 7), p(10, 7), p(20, 7), p(500, 7), p(510, 7)];
    const t = tramos(pts, 10);
    expect(t.map((x) => x.map((q) => q.t))).toEqual([
      [0, 10, 20],
      [500, 510],
    ]);
  });

  it("sin huecos es un solo tramo; sin puntos, ninguno; un punto suelto es un tramo de uno", () => {
    expect(tramos([p(0, 1), p(10, 1), p(20, 1)], 10)).toHaveLength(1);
    expect(tramos([], 10)).toEqual([]);
    expect(tramos([p(0, 1), p(1000, 1)], 10).map((x) => x.length)).toEqual([1, 1]);
  });
});

describe("descripcionGrafica", () => {
  const hasta = new Date(Date.UTC(2026, 10, 19, 15));
  it("resume el rango y el periodo en texto", () => {
    const d = descripcionGrafica(
      "pH",
      2,
      [p(0, 7, 6.9, 7.3)],
      new Date(hasta.getTime() - 24 * 3600_000),
      hasta,
    );
    expect(d).toBe("pH entre 6.90 y 7.30 en las últimas 24 h.");
    const largo = descripcionGrafica(
      "pH",
      1,
      [p(0, 7)],
      new Date(hasta.getTime() - 7 * 86_400_000),
      hasta,
    );
    expect(largo).toBe("pH entre 7.0 y 7.0 en los últimos 7 días.");
  });

  it("sin datos lo dice, sin inventar cifras", () => {
    expect(descripcionGrafica("pH", 2, [], hasta, hasta)).toBe("Sin datos de pH en este periodo.");
  });
});

describe("marcasX", () => {
  it("da inicio, mitad y fin; con hora si el periodo es corto", () => {
    const hasta = new Date(Date.UTC(2026, 10, 19, 15)); // 09:00 en México
    const desde = new Date(hasta.getTime() - 24 * 3600_000);
    const m = marcasX(desde, hasta);
    expect(m).toHaveLength(3);
    expect(m[0]?.texto).toBe("09:00");
    expect(m[1]?.texto).toBe("21:00");
    expect(m[2]?.texto).toBe("09:00");
  });

  it("con un periodo largo muestra el día", () => {
    const hasta = new Date(Date.UTC(2026, 10, 19, 15));
    const m = marcasX(new Date(hasta.getTime() - 7 * 86_400_000), hasta);
    expect(m[2]?.texto).toMatch(/19/);
    expect(m[2]?.texto).not.toMatch(/:/);
  });
});
