import type { NodoDoc } from "../modulos/nodos/index.ts";
import { descifrar } from "./cifrado.ts";

/**
 * Nodos de Atlas que apuntan al MISMO dispositivo de Blynk que `token` (descifrando el token de cada
 * uno en memoria; nada se imprime). Importa porque dos nodos sobre un mismo dispositivo reaccionan
 * juntos a lo que se escriba ahí: una prueba que simula una alarma mandaría también los avisos del
 * otro nodo a su Telegram.
 */
export function nodosDelMismoDispositivo<
  T extends { blynk: Pick<NodoDoc["blynk"], "token_cifrado"> },
>(nodos: readonly T[], clave: Buffer, token: string): T[] {
  return nodos.filter((n) => {
    try {
      return descifrar(n.blynk.token_cifrado, clave) === token;
    } catch {
      // Un token que no se puede descifrar (otra clave, dato dañado) no es el mismo dispositivo.
      return false;
    }
  });
}
