import { describe, expect, it } from "vitest";
import { cifrar } from "./cifrado.ts";
import { nodosDelMismoDispositivo } from "./dispositivo-compartido.ts";

const CLAVE = Buffer.alloc(32, 7);
const OTRA = Buffer.alloc(32, 9);
const nodo = (nombre: string, token: string, clave = CLAVE) => ({
  nombre,
  blynk: { token_cifrado: cifrar(token, clave) },
});

describe("nodosDelMismoDispositivo", () => {
  it("encuentra los nodos con el mismo token aunque cada uno lo cifre distinto", () => {
    const a = nodo("Tinaco", "TOKEN-DEL-DISPOSITIVO-1");
    const b = nodo("Copia", "TOKEN-DEL-DISPOSITIVO-1");
    const c = nodo("Cisterna", "OTRO-TOKEN-DISTINTO-22");
    // El mismo token cifrado dos veces da texto distinto (IV nuevo): hay que descifrar para comparar.
    expect(a.blynk.token_cifrado).not.toBe(b.blynk.token_cifrado);
    const r = nodosDelMismoDispositivo([a, b, c], CLAVE, "TOKEN-DEL-DISPOSITIVO-1");
    expect(r.map((n) => n.nombre)).toEqual(["Tinaco", "Copia"]);
  });

  it("sin coincidencias devuelve vacío", () => {
    expect(nodosDelMismoDispositivo([nodo("A", "uno")], CLAVE, "otro")).toEqual([]);
    expect(nodosDelMismoDispositivo([], CLAVE, "otro")).toEqual([]);
  });

  it("un token que no se puede descifrar con esta clave no cuenta y no rompe nada", () => {
    const ajeno = nodo("Ajeno", "TOKEN-DEL-DISPOSITIVO-1", OTRA);
    const roto = { nombre: "Roto", blynk: { token_cifrado: "esto no es un paquete" } };
    expect(nodosDelMismoDispositivo([ajeno, roto], CLAVE, "TOKEN-DEL-DISPOSITIVO-1")).toEqual([]);
  });
});
