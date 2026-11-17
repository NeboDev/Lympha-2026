import { describe, expect, it } from "vitest";
import { cargarSimboloLympha, parsearSvg } from "./logo-svg.ts";

describe("parsearSvg", () => {
  it("lee el viewBox y los trazos con su color y regla de relleno", () => {
    const l = parsearSvg(
      '<svg xmlns="x" viewBox="10 20 300 200"><path fill="#5fbfb2" fill-rule="evenodd" d="M 0 0 L 1 1"/><path fill="#0a0c0c" d="M 2 2"/></svg>',
    );
    expect(l).toMatchObject({ x: 10, y: 20, ancho: 300, alto: 200 });
    expect(l.trazos).toEqual([
      { d: "M 0 0 L 1 1", relleno: "#5fbfb2", regla: "evenodd" },
      { d: "M 2 2", relleno: "#0a0c0c", regla: "nonzero" },
    ]);
  });

  it("rechaza lo que no sabe dibujar en vez de dibujarlo mal", () => {
    expect(() => parsearSvg("<svg><path fill='#000' d='M0 0'/></svg>")).toThrow(/viewBox/);
    expect(() => parsearSvg('<svg viewBox="0 0 10 10"></svg>')).toThrow(/trazos/);
    expect(() => parsearSvg('<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>')).toThrow(/fill/);
    expect(() => parsearSvg('<svg viewBox="0 0 10 10"><path fill="red" d="M0 0"/></svg>')).toThrow(
      /fill/,
    );
    expect(() =>
      parsearSvg('<svg viewBox="0 0 0 10"><path fill="#000000" d="M0 0"/></svg>'),
    ).toThrow(/viewBox/);
  });
});

describe("símbolo de Lympha", () => {
  it("el archivo copiado es dibujable: dos trazos con los colores de la marca", () => {
    const l = cargarSimboloLympha();
    expect(l.trazos.map((t) => t.relleno).sort()).toEqual(["#0a0c0c", "#5fbfb2"]);
    expect(l.ancho).toBeGreaterThan(0);
    expect(l.alto).toBeGreaterThan(0);
    for (const t of l.trazos) expect(t.d.startsWith("M")).toBe(true);
  });
});
