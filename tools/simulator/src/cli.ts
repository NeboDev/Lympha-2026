// Simulador de nodos (mínimo de H0: un nodo, una lectura por minuto).
//
//   pnpm --filter @lympha/simulator start -- --url mqtts://localhost:8883 --ca infra/certs/ca.crt
//
// Credenciales: --device-id/--password o DEV_NODO_ID/DEV_NODO_PASSWORD (los de `pnpm db:seed`).
import { parseArgs } from "node:util";
import { iniciarNodo } from "./nodo.ts";

const { values } = parseArgs({
  options: {
    "device-id": { type: "string" },
    password: { type: "string" },
    url: { type: "string", default: process.env.MQTT_URL ?? "mqtts://localhost:8883" },
    ca: { type: "string", default: process.env.MQTT_CA_FILE },
    intervalo: { type: "string", default: "60" },
    lecturas: { type: "string" },
    ayuda: { type: "boolean", short: "h" },
  },
});

if (values.ayuda) {
  console.log(`Uso: simulator [--device-id ID] [--password PW] [--url mqtts://host:8883] [--ca ca.crt]
                 [--intervalo segundos=60] [--lecturas N]`);
  process.exit(0);
}

const deviceId = values["device-id"] ?? process.env.DEV_NODO_ID;
const password = values.password ?? process.env.DEV_NODO_PASSWORD;
if (!deviceId || !password) {
  console.error("Faltan --device-id y --password (o DEV_NODO_ID y DEV_NODO_PASSWORD).");
  process.exit(1);
}

const registrar = (mensaje: string, extra?: Record<string, unknown>) =>
  console.log(
    JSON.stringify({ hora: new Date().toISOString(), nodo: deviceId.slice(-8), mensaje, ...extra }),
  );

try {
  const nodo = await iniciarNodo({
    deviceId,
    password,
    url: values.url as string,
    caFile: values.ca,
    intervaloS: Number(values.intervalo),
    ...(values.lecturas ? { maxLecturas: Number(values.lecturas) } : {}),
    log: registrar,
  });

  const salir = async () => {
    await nodo.detener();
    process.exit(0);
  };
  process.on("SIGINT", () => void salir());
  process.on("SIGTERM", () => void salir());
  if (values.lecturas) {
    await nodo.terminado;
    await salir();
  }
} catch (error) {
  console.error(`No se pudo conectar: ${(error as Error).message}`);
  process.exit(1);
}
