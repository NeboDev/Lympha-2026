import { describe, expect, it } from "vitest";
import { frasePara, NIVELES, PARAMETROS, todasLasFrases } from "./index.ts";

describe("frases de causa y acción", () => {
  it("nunca dicen 'potable' ni 'seguro' (RNF-32)", () => {
    for (const f of todasLasFrases()) {
      expect(f, f).not.toMatch(/potable|\bseguro\b|\bsegura\b|\bapta\b|\bapto\b/i);
    }
  });

  it("toda combinación de nivel y parámetro produce causa y acción no vacías", () => {
    for (const nivel of NIVELES) {
      for (const parametro of PARAMETROS) {
        for (const direccion of ["alto", "bajo"] as const) {
          for (const confianza of ["ok", "dudosa", "revisar"] as const) {
            const f = frasePara({
              nivel,
              confianza,
              limitante: { parametro, direccion },
              invalidos: confianza === "ok" ? [] : [{ parametro, motivo: "congelado" }],
            });
            expect(f.causa.length).toBeGreaterThan(10);
            expect(f.accion.length).toBeGreaterThan(10);
          }
        }
      }
    }
  });

  it("la acción se endurece con la gravedad", () => {
    const limitante = { parametro: "turbidez", direccion: "alto" } as const;
    const regular = frasePara({ nivel: "regular", confianza: "ok", limitante, invalidos: [] });
    const critica = frasePara({ nivel: "critica", confianza: "ok", limitante, invalidos: [] });
    expect(regular.causa).toBe(critica.causa);
    expect(regular.accion).not.toBe(critica.accion);
    expect(critica.accion).toMatch(/beber o cocinar/);
    expect(regular.accion).not.toMatch(/beber/);
  });

  it("sensor a revisar: nombra el sensor y pide revisarlo", () => {
    const f = frasePara({
      nivel: "sin_datos",
      confianza: "revisar",
      limitante: null,
      invalidos: [{ parametro: "tds", motivo: "fuera_de_rango" }],
    });
    expect(f.causa).toMatch(/sensor de sólidos disueltos/);
    expect(f.accion).toMatch(/sumergido/);
  });
});
