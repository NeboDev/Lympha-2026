import { readFileSync } from "node:fs";
import { connect, type IClientOptions, type MqttClient } from "mqtt";

export type { MqttClient };

export interface OpcionesMqtt {
  url: string;
  username: string;
  password: string;
  clientId: string;
  /** Ruta de la CA (solo desarrollo, con CA propia). En producción se usa el almacén del sistema. */
  caFile?: string | undefined;
  /** `false` = sesión persistente (el broker guarda los QoS 1 mientras el cliente está caído). */
  clean?: boolean;
  /**
   * Segundos que el broker conserva la sesión tras desconectar. En MQTT 5 es obligatorio para que
   * `clean: false` funcione: con el valor por defecto (0) la sesión muere al desconectar.
   */
  sessionExpiryInterval?: number;
  will?: IClientOptions["will"];
  /** Si es `true`, el `PUBACK` lo envía la aplicación (`message.handled`/`done`) y no mqtt.js. */
  customHandleAcks?: IClientOptions["customHandleAcks"];
  reconnectPeriod?: number;
}

export function crearClienteMqtt(op: OpcionesMqtt): MqttClient {
  const opciones: IClientOptions = {
    username: op.username,
    password: op.password,
    clientId: op.clientId,
    clean: op.clean ?? true,
    reconnectPeriod: op.reconnectPeriod ?? 2000,
    connectTimeout: 10_000,
    protocolVersion: 5,
    resubscribe: true,
  };
  if (op.caFile) opciones.ca = readFileSync(op.caFile);
  if (op.sessionExpiryInterval !== undefined) {
    opciones.properties = { sessionExpiryInterval: op.sessionExpiryInterval };
  }
  if (op.will) opciones.will = op.will;
  if (op.customHandleAcks) opciones.customHandleAcks = op.customHandleAcks;
  return connect(op.url, opciones);
}

/** Espera la primera conexión o falla con el error del broker (credenciales, TLS, red). */
export function esperarConexion(cliente: MqttClient, ms = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (cliente.connected) return resolve();
    const temporizador = setTimeout(() => {
      limpiar();
      reject(new Error("MQTT: tiempo de espera de conexión agotado"));
    }, ms);
    const alConectar = () => {
      limpiar();
      resolve();
    };
    const alFallar = (error: Error) => {
      limpiar();
      reject(error);
    };
    const limpiar = () => {
      clearTimeout(temporizador);
      cliente.off("connect", alConectar);
      cliente.off("error", alFallar);
    };
    cliente.once("connect", alConectar);
    cliente.once("error", alFallar);
  });
}

export async function cerrarCliente(cliente: MqttClient): Promise<void> {
  await cliente.endAsync(false);
}
