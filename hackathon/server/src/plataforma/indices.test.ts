import { describe, expect, it } from "vitest";
import { definicionesIndices, indicesObsoletos } from "./indices.ts";

describe("definicionesIndices", () => {
  it("muestras es único por (nodo_id, sesion, seq): un reinicio del nodo no choca", () => {
    const d = definicionesIndices.find(
      (x) => x.coleccion === "muestras" && x.opciones?.unique === true,
    );
    expect(d?.clave).toEqual({ nodo_id: 1, sesion: 1, seq: 1 });
    expect(d?.opciones?.partialFilterExpression).toBeDefined();
  });

  it("alertas: una sola abierta por (nodo, tipo, parámetro)", () => {
    const d = definicionesIndices.find(
      (x) => x.coleccion === "alertas" && x.opciones?.unique === true,
    );
    expect(d?.clave).toEqual({ nodo_id: 1, tipo: 1, parametro: 1 });
    expect(d?.opciones?.partialFilterExpression).toEqual({ estado: "abierta" });
  });

  it("avisos: la clave es única (no se manda dos veces lo mismo)", () => {
    const d = definicionesIndices.find(
      (x) => x.coleccion === "avisos" && x.opciones?.unique === true,
    );
    expect(d?.clave).toEqual({ clave: 1 });
  });

  it("un chat de Telegram solo pertenece a una comunidad", () => {
    const d = definicionesIndices.find(
      (x) => x.coleccion === "comunidades" && x.opciones?.unique === true,
    );
    expect(d?.clave).toEqual({ "telegram.chat_id": 1 });
  });

  it("acciones del actuador: una sola pendiente o en curso por nodo", () => {
    const d = definicionesIndices.find(
      (x) => x.coleccion === "acciones_actuador" && x.opciones?.unique === true,
    );
    expect(d?.clave).toEqual({ nodo_id: 1 });
    expect(d?.opciones?.partialFilterExpression).toEqual({
      estado: { $in: ["pendiente", "en_curso"] },
    });
  });

  it("se borra el índice viejo por (nodo_id, seq)", () => {
    expect(indicesObsoletos).toContainEqual({ coleccion: "muestras", nombre: "nodo_id_1_seq_1" });
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
