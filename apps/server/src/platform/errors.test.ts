import { describe, expect, it } from "vitest";
import { esErrorDominio, NoEncontrado, Prohibido } from "./errors.ts";

describe("errores de dominio", () => {
  it("llevan código y status", () => {
    const e = new NoEncontrado();
    expect(e.status).toBe(404);
    expect(e.codigo).toBe("no_encontrado");
    expect(e.name).toBe("NoEncontrado");
    expect(esErrorDominio(new Prohibido())).toBe(true);
    expect(esErrorDominio(new Error("x"))).toBe(false);
  });
});
