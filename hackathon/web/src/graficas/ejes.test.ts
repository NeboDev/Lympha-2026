import { describe, expect, it } from "vitest";
import { formatoEjeX } from "./ejes.ts";

const d = (iso: string) => new Date(iso);

describe("formatoEjeX", () => {
  it("en un periodo corto pone la hora de México", () => {
    const hasta = d("2026-11-18T15:05:00Z");
    const desde = d("2026-11-17T15:05:00Z");
    expect(formatoEjeX(hasta, desde, hasta, false)).toBe("09:05");
  });

  it("en un periodo largo pone el día y en el cuadro del cursor, día y hora", () => {
    const desde = d("2026-11-11T12:00:00Z");
    const hasta = d("2026-11-18T12:00:00Z");
    const t = d("2026-11-15T12:00:00Z");
    expect(formatoEjeX(t, desde, hasta, false)).toMatch(/15/);
    expect(formatoEjeX(t, desde, hasta, true)).toMatch(/15 .* 2026, 06:00/);
  });
});
