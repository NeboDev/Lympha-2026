import type { DiaHistorial } from "@lympha/contracts";
import { describe, expect, it } from "vitest";
import { completarRango, diaEnZona, rangoDias, sumarDias } from "./dias.ts";

// 15 de octubre de 2026, 12:00 UTC = 06:00 en México (sin horario de verano desde 2022)
const AHORA = Date.parse("2026-10-15T12:00:00Z");

describe("diaEnZona", () => {
  it("cuenta el día en hora de México, no en UTC", () => {
    // 01:00 UTC del 15 es todavía el 14 en México (UTC-6)
    expect(diaEnZona(Date.parse("2026-10-15T01:00:00Z"))).toBe("2026-10-14");
    expect(diaEnZona(Date.parse("2026-10-15T07:00:00Z"))).toBe("2026-10-15");
  });
});

describe("sumarDias", () => {
  it("cruza fin de mes y de año", () => {
    expect(sumarDias("2026-10-01", -1)).toBe("2026-09-30");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDias("2028-03-01", -1)).toBe("2028-02-29"); // bisiesto
  });
});

describe("rangoDias", () => {
  it("da exactamente N días, el último es hoy y van en orden", () => {
    const r = rangoDias(7, AHORA);
    expect(r).toHaveLength(7);
    expect(r.at(-1)).toBe("2026-10-15");
    expect(r[0]).toBe("2026-10-09");
    expect([...r].sort()).toEqual(r);
    expect(rangoDias(30, AHORA)[0]).toBe("2026-09-16");
  });

  it("cerca de la medianoche de México, «hoy» sigue siendo el día de México", () => {
    // 05:30 UTC del 16 = 23:30 del 15 en México
    expect(rangoDias(1, Date.parse("2026-10-16T05:30:00Z"))).toEqual(["2026-10-15"]);
  });
});

describe("completarRango", () => {
  const dia = (d: string): DiaHistorial => ({
    dia: d,
    nivel: "buena",
    evaluaciones: { buena: 10, regular: 0, mala: 0, critica: 0, sin_datos: 0 },
    wqi_prom: 90,
    wqi_min: 85,
    promedios: null,
  });

  it("rellena con celdas vacías los días sin registro y conserva los datos en su día", () => {
    const celdas = completarRango([dia("2026-10-15"), dia("2026-10-11")], 7, AHORA);
    expect(celdas).toHaveLength(7);
    expect(celdas.filter((c) => c.datos !== null).map((c) => c.dia)).toEqual([
      "2026-10-11",
      "2026-10-15",
    ]);
    expect(celdas.find((c) => c.dia === "2026-10-12")?.datos).toBeNull();
  });

  it("ignora días de la API que quedan fuera del rango pedido", () => {
    const celdas = completarRango([dia("2026-08-01")], 7, AHORA);
    expect(celdas.every((c) => c.datos === null)).toBe(true);
  });
});
