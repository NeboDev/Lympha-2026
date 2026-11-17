import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cifrar, claveDesdeBase64, descifrar } from "./cifrado.ts";

const clave = randomBytes(32);
const TOKEN = "abcDEF123_token-de-prueba-largo-0123456789";

describe("cifrado del token", () => {
  it("ida y vuelta", () => {
    expect(descifrar(cifrar(TOKEN, clave), clave)).toBe(TOKEN);
  });

  it("el paquete no contiene el token en claro y cambia en cada llamada (IV nuevo)", () => {
    const a = cifrar(TOKEN, clave);
    const b = cifrar(TOKEN, clave);
    expect(a).not.toContain(TOKEN);
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
  });

  it("falla con otra clave, sin revelar nada", () => {
    const paquete = cifrar(TOKEN, clave);
    expect(() => descifrar(paquete, randomBytes(32))).toThrow("No se pudo descifrar el valor");
  });

  it("falla si el paquete fue alterado (autenticado)", () => {
    const partes = cifrar(TOKEN, clave).split(":");
    const cifrado = Buffer.from(partes[3] as string, "base64");
    cifrado[0] = (cifrado[0] ?? 0) ^ 0xff;
    partes[3] = cifrado.toString("base64");
    expect(() => descifrar(partes.join(":"), clave)).toThrow(/No se pudo descifrar/);
  });

  it("rechaza paquetes con forma inválida", () => {
    expect(() => descifrar("hola", clave)).toThrow(/No se pudo descifrar/);
    expect(() => descifrar("v9:a:b:c", clave)).toThrow(/No se pudo descifrar/);
  });

  it("la clave debe ser de 32 bytes en base64", () => {
    expect(claveDesdeBase64(randomBytes(32).toString("base64"))).toHaveLength(32);
    expect(() => claveDesdeBase64(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
