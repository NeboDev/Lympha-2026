import { describe, expect, it } from "vitest";
import { esErrorDominio, NoEncontrado, Prohibido, traducirErrorPg } from "./errors.ts";

describe("errores de dominio", () => {
  it("llevan código y status", () => {
    const e = new NoEncontrado();
    expect(e.status).toBe(404);
    expect(e.codigo).toBe("no_encontrado");
    expect(e.name).toBe("NoEncontrado");
    expect(esErrorDominio(new Prohibido())).toBe(true);
    expect(esErrorDominio(new Error("x"))).toBe(false);
  });

  describe("traducirErrorPg", () => {
    /** Drizzle envuelve el error de pg: el SQLSTATE y el mensaje están en `cause`. */
    const deLaBase = (code: string, message: string) =>
      new Error("Failed query", { cause: Object.assign(new Error(message), { code }) });

    it.each([
      ["42501", "no_autorizado", 403, "prohibido"],
      ["P0001", "reclamo_invalido", 404, "reclamo_invalido"],
      ["P0001", "invitacion_invalida", 404, "invitacion_invalida"],
      ["P0001", "limite_espacios", 409, "limite_espacios"],
      ["P0001", "transferir_primero", 409, "transferir_primero"],
      ["P0001", "transferencia_invalida", 400, "invalido"],
      ["23503", "violates foreign key constraint", 400, "invalido"],
      ["22P02", "invalid input syntax", 400, "invalido"],
      ["23505", "duplicate key", 409, "conflicto"],
    ])("%s %s -> %i", (code, mensaje, status, codigo) => {
      const e = traducirErrorPg(deLaBase(code, mensaje));
      expect(e?.status).toBe(status);
      expect(e?.codigo).toBe(codigo);
    });

    it("no traduce errores desconocidos ni expone el mensaje de la base", () => {
      expect(traducirErrorPg(deLaBase("XX000", "internal"))).toBeNull();
      expect(traducirErrorPg(deLaBase("P0001", "otra_cosa"))).toBeNull();
      expect(traducirErrorPg(new Error("x"))).toBeNull();
      expect(traducirErrorPg(deLaBase("42501", "detalle interno"))?.message).not.toContain(
        "detalle",
      );
    });
  });
});
