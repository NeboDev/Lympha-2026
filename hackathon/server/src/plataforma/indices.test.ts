import { describe, expect, it } from "vitest";
import { definicionesIndices } from "./indices.ts";

describe("definicionesIndices", () => {
  it("muestras tiene el índice único parcial por (nodo_id, seq) para la ingesta idempotente", () => {
    const d = definicionesIndices.find(
      (x) => x.coleccion === "muestras" && x.opciones?.unique === true,
    );
    expect(d?.clave).toEqual({ nodo_id: 1, seq: 1 });
    expect(d?.opciones?.partialFilterExpression).toBeDefined();
  });

  it("vinculos_pendientes expira solo por TTL y el token es único", () => {
    const ttl = definicionesIndices.find((x) => x.opciones?.expireAfterSeconds === 0);
    expect(ttl?.coleccion).toBe("vinculos_pendientes");
    const unico = definicionesIndices.find(
      (x) => x.coleccion === "vinculos_pendientes" && x.opciones?.unique === true,
    );
    expect(unico?.clave).toEqual({ token: 1 });
  });
});
