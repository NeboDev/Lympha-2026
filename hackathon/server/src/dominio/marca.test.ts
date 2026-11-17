import { describe, expect, it } from "vitest";
import { cargarMarca } from "../plataforma/marca.ts";
import { parsearMarca } from "./marca.ts";

describe("marca.json", () => {
  it("el archivo real es válido y trae el nombre del bot", () => {
    const m = cargarMarca();
    expect(m.nombre).toBe("Lympha Atl");
    expect(m.nombre_bot).toBe("Lympha-HP26");
  });

  it("no promete cosas que aún no existen", () => {
    // Estas afirmaciones solo se activan cuando el firmware y el control del actuador estén probados.
    const m = cargarMarca();
    expect(m.alarma_local_en_avisos).toBe(false);
    expect(m.dosificacion_automatica).toBe(false);
  });

  it("rechaza claves desconocidas y valores de tipo equivocado", () => {
    const ok = cargarMarca();
    expect(() => parsearMarca({ ...ok, extra: 1 })).toThrow(/inválido/);
    expect(() => parsearMarca({ ...ok, nombre: "" })).toThrow(/inválido/);
    expect(() => parsearMarca({ ...ok, dosificacion_automatica: "sí" })).toThrow(/inválido/);
  });
});
