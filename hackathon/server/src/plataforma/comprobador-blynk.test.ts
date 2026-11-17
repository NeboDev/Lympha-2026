import { describe, expect, it } from "vitest";
import { BlynkError } from "./blynk.ts";
import { crearComprobadorBlynk } from "./comprobador-blynk.ts";

const con = (r: () => Promise<boolean>) => crearComprobadorBlynk({ nodoConectado: r });

describe("crearComprobadorBlynk", () => {
  it("true es «conectado» y false es «desconectado» (pero con un token válido)", async () => {
    expect(await con(async () => true).comprobar("t")).toBe("conectado");
    expect(await con(async () => false).comprobar("t")).toBe("desconectado");
  });

  it("un 400 de Blynk (token que no reconoce) es «invalido»", async () => {
    const r = con(async () => {
      throw new BlynkError("Blynk respondió 400", 400);
    });
    expect(await r.comprobar("t")).toBe("invalido");
  });

  it("un fallo de red, un tiempo agotado o un 5xx es «sin_respuesta», no «invalido»", async () => {
    for (const error of [
      new BlynkError("Sin respuesta de Blynk"),
      new BlynkError("Blynk respondió 503", 503),
      new Error("algo raro"),
    ]) {
      const r = con(async () => {
        throw error;
      });
      expect(await r.comprobar("t")).toBe("sin_respuesta");
    }
  });
});
