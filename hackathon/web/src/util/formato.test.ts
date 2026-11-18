import { describe, expect, it } from "vitest";
import {
  aInputLocal,
  desdeInputLocal,
  duracionCorta,
  fechaMx,
  haceLegible,
  horaMx,
  segundosRestantes,
  valorLegible,
} from "./formato.ts";

describe("fechas en hora de México", () => {
  // 2026-11-19 15:00 UTC = 09:00 en la Ciudad de México (UTC−6, sin horario de verano).
  const t = new Date(Date.UTC(2026, 10, 19, 15, 0));

  it("fechaMx y horaMx", () => {
    expect(fechaMx(t)).toBe("19 nov 2026, 09:00");
    expect(fechaMx(t, false)).toBe("19 nov 2026");
    expect(horaMx(t)).toBe("09:00");
  });

  it("cerca de la medianoche cambia el día respecto de UTC", () => {
    expect(fechaMx(new Date(Date.UTC(2026, 0, 1, 3, 30)))).toBe("31 dic 2025, 21:30");
  });

  it("aInputLocal y desdeInputLocal son inversos", () => {
    expect(aInputLocal(t)).toBe("2026-11-19T09:00");
    expect(desdeInputLocal("2026-11-19T09:00")).toEqual(t);
    expect(desdeInputLocal(aInputLocal(t))).toEqual(t);
  });

  it("desdeInputLocal rechaza lo que no es una fecha-hora", () => {
    expect(desdeInputLocal("")).toBeNull();
    expect(desdeInputLocal("19/11/2026")).toBeNull();
    expect(desdeInputLocal("2026-11-19")).toBeNull();
  });
});

describe("haceLegible", () => {
  it("elige la unidad y concuerda el plural", () => {
    expect(haceLegible(4)).toBe("hace 4 s");
    expect(haceLegible(60)).toBe("hace 1 minuto");
    expect(haceLegible(300)).toBe("hace 5 minutos");
    expect(haceLegible(3600)).toBe("hace 1 hora");
    expect(haceLegible(7200)).toBe("hace 2 horas");
    expect(haceLegible(3 * 86_400)).toBe("hace 3 días");
    expect(haceLegible(-5)).toBe("hace 0 s");
  });
});

describe("valorLegible", () => {
  it("usa los decimales pedidos y no inventa cifras", () => {
    expect(valorLegible(7.123, 2)).toBe("7.12");
    expect(valorLegible(7, 1)).toBe("7.0");
    expect(valorLegible(null, 2)).toBe("—");
    expect(valorLegible(undefined, 2)).toBe("—");
    expect(valorLegible(Number.NaN, 2)).toBe("—");
  });
});

describe("segundosRestantes y duracionCorta", () => {
  it("cuentan hacia arriba, sin bajar de cero", () => {
    const ahora = new Date(1_000_000);
    expect(segundosRestantes(new Date(1_000_000 + 4_200), ahora)).toBe(5);
    expect(segundosRestantes(new Date(1_000_000 + 1_000), ahora)).toBe(1);
    expect(segundosRestantes(new Date(1_000_000), ahora)).toBe(0);
    expect(segundosRestantes(new Date(900_000), ahora)).toBe(0);
  });

  it("duracionCorta", () => {
    expect(duracionCorta(0)).toBe("0 s");
    expect(duracionCorta(45)).toBe("45 s");
    expect(duracionCorta(60)).toBe("1 min");
    expect(duracionCorta(80)).toBe("1 min 20 s");
    expect(duracionCorta(-3)).toBe("0 s");
  });
});
