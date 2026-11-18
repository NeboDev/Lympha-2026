import { describe, expect, it } from "vitest";
import { nodoDePrueba } from "../test/falsos.ts";
import { cifrar } from "./cifrado.ts";
import { crearEscritorActuadorBlynk } from "./escritor-actuador-blynk.ts";

const CLAVE = Buffer.alloc(32, 5);

describe("escritor del actuador (Blynk)", () => {
  it("rechaza un pin que no sea virtual: nunca se escribe en cualquier lado", async () => {
    const nodo = {
      ...nodoDePrueba(),
      blynk: {
        ...nodoDePrueba().blynk,
        token_cifrado: cifrar("TOKEN-DE-PRUEBA-0123456789", CLAVE),
      },
    };
    const escritor = crearEscritorActuadorBlynk({ clave: CLAVE });
    for (const pin of ["d13", "../admin", "v8&token=otro", "", "8"]) {
      await expect(escritor.escribir(nodo, pin, 1), pin).rejects.toThrow(/Pin inválido/);
    }
  });

  it("un token que no se puede descifrar falla sin llegar a la red", async () => {
    const nodo = {
      ...nodoDePrueba(),
      blynk: { ...nodoDePrueba().blynk, token_cifrado: "esto no es un paquete" },
    };
    await expect(
      crearEscritorActuadorBlynk({ clave: CLAVE }).escribir(nodo, "v8", 1),
    ).rejects.toThrow();
  });
});
