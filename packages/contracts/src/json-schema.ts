import { ackComandoV1, atributosV1, comandoV1, configV1, telemetriaV1 } from "./mqtt.ts";

/** Esquemas del contrato v1 que se exportan como JSON Schema para el firmware. Se importa solo desde scripts y pruebas. */
export const esquemasMqtt = {
  telemetry: telemetriaV1,
  attributes: atributosV1,
  cmd: comandoV1,
  "cmd-ack": ackComandoV1,
  config: configV1,
};
