import { describe, expect, it } from "vitest";
import { avanzar, elegirModo, OLAS, posicionesDeReposo } from "./olas.ts";

const consulta = (activas: string[]) => (media: string) => ({ matches: activas.includes(media) });
const TACTIL = "(hover: none), (pointer: coarse)";
const QUIETO = "(prefers-reduced-motion: reduce)";

describe("elegirModo", () => {
  it("anima solo con puntero fino y sin pedir menos movimiento", () => {
    expect(elegirModo(consulta([]))).toBe("animado");
  });
  it("es estático en táctil", () => {
    expect(elegirModo(consulta([TACTIL]))).toBe("estatico");
  });
  it("es estático con «reducir movimiento»", () => {
    expect(elegirModo(consulta([QUIETO]))).toBe("estatico");
  });
});

describe("avanzar", () => {
  it("las olas se acercan al cursor sin pasarse y con distinta atracción", () => {
    const estado = posicionesDeReposo(1000, 800);
    const antes = estado.pos.map((p) => ({ ...p }));
    const cursor = { x: 900, y: 700 };
    for (let i = 0; i < 600; i++) avanzar(estado, 1000, 800, cursor, 1 / 60);
    OLAS.forEach((o, i) => {
      const p = estado.pos[i];
      const a = antes[i];
      if (!p || !a) throw new Error("falta una ola");
      // converge al punto de reposo + atracción × (cursor − reposo)
      expect(p.x).toBeCloseTo(a.x + (cursor.x - a.x) * o.atraccion, 0);
      expect(p.y).toBeCloseTo(a.y + (cursor.y - a.y) * o.atraccion, 0);
    });
  });
  it("sin movimiento del cursor (en el centro) las olas se quedan cerca de su reposo", () => {
    const estado = posicionesDeReposo(1000, 800);
    avanzar(estado, 1000, 800, { x: 500, y: 400 }, 1 / 60);
    for (const [i, p] of estado.pos.entries()) {
      const o = OLAS[i];
      if (!o) throw new Error("falta una ola");
      expect(Math.abs(p.x - o.x * 1000)).toBeLessThan(40);
    }
  });
});
