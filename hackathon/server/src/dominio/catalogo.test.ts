import { describe, expect, it } from "vitest";
import { cargarCatalogo } from "../plataforma/catalogo.ts";
import { parametroDe, parsearCatalogo } from "./catalogo.ts";

describe("catálogo de parámetros", () => {
  it("el parametros.json real es válido", () => {
    const c = cargarCatalogo();
    const ph = parametroDe(c, "ph");
    expect(ph.norma).toMatchObject({ min: 6.5, max: 8.5 });
    expect(ph.reglas?.lecturas_para_entrar).toBe(3);
    expect(ph.cloro?.temp_defecto_c).toBe(25);
  });

  it("los parámetros no medibles no traen reglas ni pin de Blynk", () => {
    const c = cargarCatalogo();
    for (const [id, p] of Object.entries(c.parametros)) {
      if (!p.medible) {
        expect(p.reglas, id).toBeUndefined();
        expect(p.blynk, id).toBeNull();
      }
    }
  });

  it("rechaza claves desconocidas", () => {
    const c = cargarCatalogo();
    expect(() => parsearCatalogo({ ...c, extra: 1 })).toThrow(/inválido/);
    const ph = { ...c.parametros.ph, inventado: true };
    expect(() => parsearCatalogo({ ...c, parametros: { ph } })).toThrow(/inválido/);
  });

  it("parametroDe falla con un id que no existe", () => {
    expect(() => parametroDe(cargarCatalogo(), "orp_x")).toThrow(/desconocido/);
  });
});
