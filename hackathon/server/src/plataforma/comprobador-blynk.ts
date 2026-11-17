import type { ComprobadorToken } from "../modulos/nodos/index.ts";
import { BlynkError, type ClienteBlynk } from "./blynk.ts";

/**
 * Comprueba un token de Blynk con `isHardwareConnected`: Blynk contesta 400 si no lo reconoce, y
 * `true`/`false` si es válido (según la placa esté o no conectada). Un token válido con la placa
 * apagada se acepta: el alta no debe depender de que el nodo esté encendido ese minuto.
 */
export function crearComprobadorBlynk(
  cliente: Pick<ClienteBlynk, "nodoConectado">,
): ComprobadorToken {
  return {
    async comprobar(token) {
      try {
        return (await cliente.nodoConectado(token)) ? "conectado" : "desconectado";
      } catch (e) {
        if (e instanceof BlynkError && e.estado !== null && e.estado >= 400 && e.estado < 500) {
          return "invalido";
        }
        return "sin_respuesta";
      }
    },
  };
}
