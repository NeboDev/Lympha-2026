import type { EscritorActuador } from "../modulos/control/index.ts";
import { type ClienteBlynk, crearClienteBlynk } from "./blynk.ts";
import { descifrar } from "./cifrado.ts";

/**
 * `EscritorActuador` real: descifra el token del nodo y escribe un 1 o un 0 en el pin del relevador.
 * Única pieza (junto a `blynk.ts`) que puede mover un actuador: el pin lo decide el mapeo del nodo, nunca
 * una petición. Blynk guarda el último valor escrito, así que NO sirve para saber si el relevador actuó.
 */
export function crearEscritorActuadorBlynk(opciones: { clave: Buffer }): EscritorActuador {
  const clientes = new Map<string, ClienteBlynk>();
  return {
    async escribir(nodo, pin, valor) {
      let cliente = clientes.get(nodo.blynk.host);
      if (!cliente) {
        cliente = crearClienteBlynk({ host: nodo.blynk.host });
        clientes.set(nodo.blynk.host, cliente);
      }
      await cliente.escribirPines(descifrar(nodo.blynk.token_cifrado, opciones.clave), {
        [pin]: valor,
      });
    },
  };
}
