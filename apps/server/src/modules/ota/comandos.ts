import { type ComandoV1, comandoV1, topico } from "@lympha/contracts";
import type { MqttClient } from "../../platform/mqtt.ts";

/** Publica un comando al nodo (`cmd`, QoS 1, sin retener: un comando viejo no debe ejecutarse al reconectar). */
export async function publicarComando(
  mqtt: MqttClient,
  deviceId: string,
  comando: ComandoV1,
): Promise<void> {
  const valido = comandoV1.parse(comando);
  await mqtt.publishAsync(topico(deviceId, "cmd"), JSON.stringify(valido), {
    qos: 1,
    retain: false,
  });
}

/** `http://<ip>:<puerto>/fw/lympha-1.1.0.bin` */
export function urlDeFirmware(baseUrl: string, archivo: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/fw/${archivo}`;
}
