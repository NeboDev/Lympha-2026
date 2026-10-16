// CLI del OTA (H5): versiones de firmware, despliegue gradual y servidor de binarios en la red local.
//
//   pnpm ota registrar <binario.bin> --version 1.1.0
//   pnpm ota servir                         # sirve OTA_DIR en OTA_PORT (los nodos lo ven en OTA_BASE_URL)
//   pnpm ota desplegar <versión> [--etapas 5,25,100] [--ventana-min 10]
//   pnpm ota estado
//   pnpm ota abortar
//
// Los comandos salen como `lympha-control`. El rollback de cada nodo lo hace su bootloader; aquí solo se mide
// que los nodos actualizados vuelvan en línea y publicando antes de avanzar de etapa.
import { parseArgs } from "node:util";
import pg from "pg";
import {
  abortarDespliegue,
  crearServidorOta,
  depsDesdeBd,
  desplegar,
  obtenerVersion,
  registrarVersion,
  resumen,
} from "../modules/ota/index.ts";
import { cargarConfigOSalir } from "../platform/config.ts";
import { crearLogger } from "../platform/logger.ts";
import { cerrarCliente, crearClienteMqtt, esperarConexion } from "../platform/mqtt.ts";

const [comando, ...resto] = process.argv.slice(2);
const { values, positionals } = parseArgs({
  args: resto,
  allowPositionals: true,
  options: {
    version: { type: "string" },
    etapas: { type: "string", default: "5,25,100" },
    "ventana-min": { type: "string", default: "10" },
  },
});

const uso = `Uso: ota registrar <binario.bin> --version X.Y.Z
     ota servir
     ota desplegar <versión> [--etapas 5,25,100] [--ventana-min 10]
     ota estado
     ota abortar`;

if (!comando || !["registrar", "servir", "desplegar", "estado", "abortar"].includes(comando)) {
  console.error(uso);
  process.exit(2);
}

const config = cargarConfigOSalir("ota");
const log = crearLogger("ota", config.LOG_LEVEL);

if (comando === "servir") {
  const servidor = crearServidorOta(config.OTA_DIR);
  servidor.listen(config.OTA_PORT, "0.0.0.0", () =>
    console.log(
      `Sirviendo ${config.OTA_DIR} en el puerto ${config.OTA_PORT} (GET /fw/lympha-<versión>.bin)`,
    ),
  );
} else {
  const db = new pg.Client({ connectionString: config.DATABASE_URL_MIGRATE });
  let mqtt: ReturnType<typeof crearClienteMqtt> | null = null;
  try {
    await db.connect();

    if (comando === "registrar") {
      const [archivo] = positionals;
      if (!archivo || !values.version) {
        console.error(uso);
        process.exit(2);
      }
      const v = await registrarVersion(db, config.OTA_DIR, archivo, values.version);
      console.log(`Versión ${v.version}: ${v.tamanoBytes} bytes, sha256 ${v.sha256}`);
    } else if (comando === "estado") {
      const r = await resumen(db);
      console.log("Versiones:");
      for (const v of r.versiones)
        console.log(`  ${v.version}  ${v.nodos} nodos  ${v.sha256.slice(0, 12)}…`);
      if (r.versiones.length === 0) console.log("  (ninguna registrada)");
      console.log(
        r.despliegue
          ? `Último despliegue: ${r.despliegue.version}, etapa ${r.despliegue.etapa} %, ${r.despliegue.estado}${r.despliegue.motivo ? ` (${r.despliegue.motivo})` : ""}`
          : "Sin despliegues.",
      );
    } else if (comando === "abortar") {
      const id = await abortarDespliegue(db, "detenido por el operador");
      console.log(id ? `Despliegue ${id} detenido.` : "No hay despliegue en curso.");
    } else {
      const [version] = positionals;
      if (!version) {
        console.error(uso);
        process.exit(2);
      }
      if (!config.OTA_BASE_URL) throw new Error("falta OTA_BASE_URL (http://<IP de la PC>:8080)");
      const fw = await obtenerVersion(db, version);
      if (!fw) throw new Error(`la versión ${version} no está registrada (pnpm ota registrar)`);
      const etapas = (values.etapas as string).split(",").map((e) => Number(e.trim()));
      if (etapas.some((e) => !Number.isInteger(e) || e < 1 || e > 100) || etapas.at(-1) !== 100) {
        throw new Error("--etapas debe ser una lista creciente de porcentajes que termine en 100");
      }
      const ventanaMs = Number(values["ventana-min"]) * 60_000;
      if (!Number.isFinite(ventanaMs) || ventanaMs <= 0) throw new Error("--ventana-min inválido");

      mqtt = crearClienteMqtt({
        url: config.MQTT_URL,
        username: config.MQTT_CONTROL_USER,
        password: config.MQTT_CONTROL_PASSWORD,
        clientId: `${config.MQTT_CONTROL_USER}-ota-${process.pid}`,
        caFile: config.MQTT_CA_FILE,
      });
      await esperarConexion(mqtt);
      const r = await desplegar(
        depsDesdeBd(db, mqtt, fw, config.OTA_BASE_URL, (t) => console.log(t)),
        version,
        { etapas, ventanaMs },
      );
      console.log(
        r.estado === "completado"
          ? `Despliegue completado: ${r.actualizados} nodos con ${version}.`
          : `Despliegue detenido en ${r.etapa} %: ${r.motivo}`,
      );
      if (r.estado !== "completado") process.exitCode = 1;
    }
  } catch (error) {
    log.error({ err: error }, "ota falló");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await db.end().catch(() => undefined);
    if (mqtt) {
      const c = mqtt;
      await cerrarCliente(c).catch(() => c.end(true));
    }
  }
}
