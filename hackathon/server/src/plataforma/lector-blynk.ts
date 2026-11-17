import type { LectorNodo } from "../modulos/ingesta/index.ts";
import { type ClienteBlynk, crearClienteBlynk } from "./blynk.ts";
import { descifrar } from "./cifrado.ts";

/** `LectorNodo` real: descifra el token del nodo y le pide a Blynk todos sus pines. */
export function crearLectorBlynk(opciones: { clave: Buffer }): LectorNodo {
  const clientes = new Map<string, ClienteBlynk>();
  return {
    async leer(nodo) {
      let cliente = clientes.get(nodo.blynk.host);
      if (!cliente) {
        cliente = crearClienteBlynk({ host: nodo.blynk.host });
        clientes.set(nodo.blynk.host, cliente);
      }
      const token = descifrar(nodo.blynk.token_cifrado, opciones.clave);
      return cliente.leerTodo(token);
    },
  };
}
