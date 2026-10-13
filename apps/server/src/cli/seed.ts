// Semillas de DESARROLLO (pnpm db:seed): un usuario, un espacio, su membresía de propietario, un lote y
// un nodo reclamado por ese espacio, más el cliente del nodo en Dynamic Security para que el simulador
// pueda conectarse. Idempotente. Se niega a correr fuera de APP_ENV=local.
import { normalizarCodigoReclamo } from "@lympha/contracts";
import pg from "pg";
import { DEV } from "../modules/fabrica/index.ts";
import { cargarConfigOSalir } from "../platform/config.ts";
import { ClienteDynsec } from "../platform/dynsec.ts";
import { crearLogger } from "../platform/logger.ts";
import { cerrarCliente, crearClienteMqtt, esperarConexion } from "../platform/mqtt.ts";

const config = cargarConfigOSalir("seed");
const log = crearLogger("seed", config.LOG_LEVEL);

if (config.APP_ENV !== "local") {
  log.error("db:seed solo corre con APP_ENV=local");
  process.exit(1);
}

const db = new pg.Client({ connectionString: config.DATABASE_URL_MIGRATE });
const mqtt = crearClienteMqtt({
  url: config.MQTT_URL,
  username: config.MQTT_ADMIN_USER,
  password: config.MQTT_ADMIN_PASSWORD,
  clientId: `${config.MQTT_ADMIN_USER}-seed`,
  caFile: config.MQTT_CA_FILE,
});

try {
  await db.connect();
  await db.query("BEGIN");
  await db.query(
    `INSERT INTO app.usuarios (id, auth_uid, email, nombre)
     VALUES ($1, 'dev-uid', 'dev@lympha.test', 'Usuario de desarrollo')
     ON CONFLICT (id) DO NOTHING`,
    [DEV.usuarioId],
  );
  await db.query(
    `INSERT INTO app.espacios (id, nombre, tipo) VALUES ($1, 'Casa (desarrollo)', 'hogar')
     ON CONFLICT (id) DO NOTHING`,
    [DEV.espacioId],
  );
  await db.query(
    `INSERT INTO app.membresias (espacio_id, usuario_id, rol) VALUES ($1, $2, 'propietario')
     ON CONFLICT (espacio_id, usuario_id) DO NOTHING`,
    [DEV.espacioId, DEV.usuarioId],
  );
  await db.query(
    `INSERT INTO app.lotes (id, cantidad, version_hw, notas) VALUES ($1, 1, 'dev', 'semilla de desarrollo')
     ON CONFLICT (id) DO NOTHING`,
    [DEV.loteId],
  );
  await db.query(
    `INSERT INTO app.nodos (id, lote_id, espacio_id, nombre, claim_hash, estado, reclamado_en)
     VALUES ($1, $2, $3, 'Cisterna (simulada)', digest($4::text || $5::text, 'sha256'), 'reclamado', now())
     ON CONFLICT (id) DO NOTHING`,
    [
      config.DEV_NODO_ID,
      DEV.loteId,
      DEV.espacioId,
      normalizarCodigoReclamo(config.DEV_NODO_CODIGO),
      config.CLAIM_PEPPER,
    ],
  );
  await db.query(
    `INSERT INTO app.estado_nodo (nodo_id, espacio_id) VALUES ($1, $2) ON CONFLICT (nodo_id) DO NOTHING`,
    [config.DEV_NODO_ID, DEV.espacioId],
  );
  await db.query("COMMIT");

  await esperarConexion(mqtt);
  await new ClienteDynsec(mqtt).asegurarNodo({
    deviceId: config.DEV_NODO_ID,
    password: config.DEV_NODO_PASSWORD,
    loteId: DEV.loteId,
  });

  log.info(
    { usuarioId: DEV.usuarioId, espacioId: DEV.espacioId, nodoId: config.DEV_NODO_ID },
    "semillas de desarrollo listas",
  );
} catch (error) {
  await db.query("ROLLBACK").catch(() => undefined);
  log.error({ err: error }, "db:seed falló");
  process.exitCode = 1;
} finally {
  await db.end().catch(() => undefined);
  await cerrarCliente(mqtt).catch(() => mqtt.end(true));
}
