import { randomUUID } from "node:crypto";
import { ClienteDynsec } from "../../platform/dynsec.ts";
import { ServicioNoDisponible } from "../../platform/errors.ts";
import { cerrarCliente, crearClienteMqtt, esperarConexion } from "../../platform/mqtt.ts";

/**
 * Acceso puntual al administrador de Dynamic Security. La API NO mantiene una sesión de administrador: cada
 * operación del panel abre una conexión, ejecuta y la cierra, para que la credencial viva en memoria el menor
 * tiempo y la sesión del broker no quede abierta entre peticiones.
 */
export type ConBrokerAdmin = <T>(fn: (dynsec: ClienteDynsec) => Promise<T>) => Promise<T>;

export interface OpcionesBrokerAdmin {
  url: string;
  usuario: string;
  password: string;
  caFile?: string | undefined;
}

export function crearConBrokerAdmin(op: OpcionesBrokerAdmin): ConBrokerAdmin {
  return async (fn) => {
    const mqtt = crearClienteMqtt({
      url: op.url,
      username: op.usuario,
      password: op.password,
      clientId: `${op.usuario}-api-${randomUUID().slice(0, 8)}`,
      caFile: op.caFile,
      reconnectPeriod: 0,
    });
    // Un error de conexión llega como evento; sin escucha tumbaría el proceso.
    mqtt.on("error", () => undefined);
    try {
      try {
        await esperarConexion(mqtt, 8_000);
      } catch {
        throw new ServicioNoDisponible("No se pudo contactar al broker de administración");
      }
      return await fn(new ClienteDynsec(mqtt));
    } finally {
      await cerrarCliente(mqtt).catch(() => mqtt.end(true));
    }
  };
}
