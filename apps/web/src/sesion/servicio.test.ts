import { describe, expect, it } from "vitest";
import { traducirErrorAcceso } from "./servicio.ts";

describe("traducirErrorAcceso", () => {
  it("usa el mismo mensaje para correo inexistente y contraseña errónea (no revela qué cuentas existen)", () => {
    const a = traducirErrorAcceso("auth/user-not-found");
    expect(a).toBe(traducirErrorAcceso("auth/wrong-password"));
    expect(a).toBe(traducirErrorAcceso("auth/invalid-credential"));
  });

  it("traduce los casos comunes al español", () => {
    expect(traducirErrorAcceso("auth/email-already-in-use")).toMatch(/Ya existe una cuenta/);
    expect(traducirErrorAcceso("auth/weak-password")).toMatch(/al menos 6/);
    expect(traducirErrorAcceso("auth/network-request-failed")).toMatch(/conexión/);
  });

  it("un código desconocido o ausente da un mensaje genérico sin exponer el código", () => {
    for (const raro of ["auth/algo-nuevo", undefined, null, 42]) {
      const m = traducirErrorAcceso(raro);
      expect(m).toBe("No se pudo completar el acceso. Inténtalo de nuevo.");
      expect(m).not.toMatch(/auth\//);
    }
  });
});
