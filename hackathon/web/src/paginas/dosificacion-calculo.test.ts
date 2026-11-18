import { describe, expect, it } from "vitest";
import { ESTADOS_ACCION } from "../api/tipos.ts";
import { describirAccion, ETIQUETA_ACCION, estaViva } from "./dosificacion-calculo.ts";

describe("describirAccion", () => {
  const base = { estado: "terminada" as const, duracion_s: 20, automatica: false, simulado: false };

  it("dice qué pasó con la orden, con la duración legible", () => {
    expect(describirAccion(base)).toBe("Pulso de 20 s · Terminada");
    expect(describirAccion({ ...base, duracion_s: 80, estado: "cancelada" })).toBe(
      "Pulso de 1 min 20 s · Cancelada",
    );
  });

  it("distingue lo que detuvo una persona de lo que detuvo la regla de seguridad", () => {
    expect(describirAccion({ ...base, estado: "detenida" })).toBe("Pulso de 20 s · Detenida");
    expect(describirAccion({ ...base, estado: "detenida", automatica: true })).toBe(
      "Pulso de 20 s · Detenida por seguridad",
    );
  });

  it("rotula lo simulado", () => {
    expect(describirAccion({ ...base, simulado: true })).toBe(
      "Pulso de 20 s · Terminada (simulado)",
    );
  });

  it("todas las etiquetas existen y ninguna afirma que se dosificó, ni dice «potable» o «seguro»", () => {
    for (const estado of ESTADOS_ACCION) {
      const t = ETIQUETA_ACCION[estado];
      expect(t.length, estado).toBeGreaterThan(3);
      expect(t, estado).not.toMatch(/dosific|potable|segur[oa]s?\b/i);
    }
  });
});

describe("estaViva", () => {
  it("solo pendiente y en curso ocupan el actuador", () => {
    expect(estaViva({ estado: "pendiente" })).toBe(true);
    expect(estaViva({ estado: "en_curso" })).toBe(true);
    for (const e of [
      "terminada",
      "detenida",
      "cancelada",
      "expirada",
      "rechazada",
      "fallida",
    ] as const) {
      expect(estaViva({ estado: e }), e).toBe(false);
    }
    expect(estaViva(null)).toBe(false);
  });
});
