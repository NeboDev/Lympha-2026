import { describe, expect, it } from "vitest";
import { traducirErrorAcceso } from "./firebase.ts";

describe("traducirErrorAcceso", () => {
  it("explica los fallos comunes en lenguaje sencillo y con qué hacer", () => {
    expect(traducirErrorAcceso("auth/popup-closed-by-user")).toMatch(/Cerraste la ventana/);
    expect(traducirErrorAcceso("auth/popup-blocked")).toMatch(/ventanas emergentes/);
    expect(traducirErrorAcceso("auth/network-request-failed")).toMatch(/Revisa tu internet/);
    expect(traducirErrorAcceso("auth/unauthorized-domain")).toMatch(/Dominios autorizados/);
    expect(traducirErrorAcceso("auth/operation-not-allowed")).toMatch(/no está activado/);
  });

  it("un código desconocido da un mensaje genérico, sin el texto técnico", () => {
    for (const codigo of ["auth/algo-raro", undefined, 42, null]) {
      const t = traducirErrorAcceso(codigo);
      expect(t).toBe("No pudimos iniciar sesión. Inténtalo de nuevo.");
      expect(t).not.toMatch(/auth\//);
    }
  });
});
