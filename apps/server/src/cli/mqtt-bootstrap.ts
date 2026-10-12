// Aplica la base de Mosquitto Dynamic Security (ACL por defecto, roles, clientes internos). Idempotente.

import { cargarConfigOSalir } from "../platform/config.ts";
import { ClienteDynsec } from "../platform/dynsec.ts";
import { crearLogger } from "../platform/logger.ts";
import { cerrarCliente, crearClienteMqtt, esperarConexion } from "../platform/mqtt.ts";

const config = cargarConfigOSalir("mqtt-bootstrap");
const log = crearLogger("mqtt-bootstrap", config.LOG_LEVEL);

const cliente = crearClienteMqtt({
  url: config.MQTT_URL,
  username: config.MQTT_ADMIN_USER,
  password: config.MQTT_ADMIN_PASSWORD,
  clientId: `${config.MQTT_ADMIN_USER}-bootstrap`,
  caFile: config.MQTT_CA_FILE,
});

try {
  await esperarConexion(cliente);
  const dynsec = new ClienteDynsec(cliente);
  await dynsec.aplicarBase([
    {
      username: config.MQTT_INGEST_USER,
      password: config.MQTT_INGEST_PASSWORD,
      rolename: "ingest",
    },
    {
      username: config.MQTT_CONTROL_USER,
      password: config.MQTT_CONTROL_PASSWORD,
      rolename: "control",
    },
  ]);
  log.info("Dynamic Security: base aplicada");
  await cerrarCliente(cliente);
} catch (error) {
  log.error({ err: error }, "mqtt-bootstrap falló");
  cliente.end(true);
  process.exit(1);
}
