import { ALFABETO_CODIGO_RECLAMO, normalizarCodigoReclamo } from "@lympha/contracts";
import { describe, expect, it } from "vitest";
import {
  formatearCodigoReclamo,
  generarClaveAp,
  generarCodigoReclamo,
  generarPasswordMqtt,
} from "./identidad.ts";

describe("identidades de fábrica", () => {
  it("el código de reclamo tiene 12 caracteres del alfabeto sin ambiguos", () => {
    for (let i = 0; i < 200; i++) {
      const c = generarCodigoReclamo();
      expect(c).toHaveLength(12);
      expect([...c].every((x) => ALFABETO_CODIGO_RECLAMO.includes(x))).toBe(true);
      expect(c).not.toMatch(/[01OIL]/);
    }
  });

  it("se imprime en grupos de 4 y al normalizar vuelve a la forma que se hashea", () => {
    const c = generarCodigoReclamo();
    const impreso = formatearCodigoReclamo(c);
    expect(impreso).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(normalizarCodigoReclamo(impreso.toLowerCase())).toBe(c);
  });

  it("las contraseñas MQTT miden 32 caracteres y no se repiten", () => {
    const todas = new Set(Array.from({ length: 500 }, generarPasswordMqtt));
    expect(todas.size).toBe(500);
    for (const p of todas) expect(p).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("la clave del AP cumple el mínimo de WPA2", () => {
    expect(generarClaveAp().length).toBeGreaterThanOrEqual(8);
  });
});
