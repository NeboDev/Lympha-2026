// CLI de fábrica (H1: lotes; H5: imágenes de identidad, etiquetas y grabado).
//
//   pnpm factory lote --cantidad 20 --version-hw v1 [--notas "lote piloto"] [--salida tools/factory/lotes]
//   pnpm factory lote --cantidad 100 --version-hw sim --dev     # solo APP_ENV=local: nodos ya reclamados por el espacio de desarrollo
//   pnpm factory revocar-nodo <deviceId>
//   pnpm factory revocar-lote <loteId>
//   pnpm factory imagenes|etiquetas|grabar|diagnostico ...   (ver fabrica-grabado.ts)
//
// Cada lote escribe dos archivos en <salida>/<loteId>/:
//   manifiesto.json   lote, fecha, cantidad, versión de hardware y los deviceId. NO contiene secretos.
//   identidades.json  por nodo: contraseña MQTT, clave del AP y código de reclamo (permisos 0600, ignorado por
//                     git). Es la entrada del grabado de H5 y del simulador (`--identidades`); no se guarda en
//                     ningún otro lado: si se pierde, el nodo debe reprogramarse con credenciales nuevas.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import pg from "pg";
import { DEV, fabricarLote, revocarLote, revocarNodo } from "../modules/fabrica/index.ts";
import { cargarConfigOSalir } from "../platform/config.ts";
import { ClienteDynsec } from "../platform/dynsec.ts";
import { crearLogger } from "../platform/logger.ts";
import { cerrarCliente, crearClienteMqtt, esperarConexion } from "../platform/mqtt.ts";
import { COMANDOS_GRABADO, ejecutarGrabado } from "./fabrica-grabado.ts";

const [comando, ...resto] = process.argv.slice(2);

if (comando && COMANDOS_GRABADO.includes(comando)) {
  try {
    await ejecutarGrabado(comando, resto);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  process.exit(0);
}

const { values, positionals } = parseArgs({
  args: resto,
  allowPositionals: true,
  options: {
    cantidad: { type: "string" },
    "version-hw": { type: "string", default: "v1" },
    notas: { type: "string" },
    salida: { type: "string", default: "tools/factory/lotes" },
    dev: { type: "boolean", default: false },
  },
});

const uso = `Uso: factory lote --cantidad N [--version-hw v1] [--notas texto] [--salida dir] [--dev]
     factory revocar-nodo <deviceId>
     factory revocar-lote <loteId>`;

if (!comando || !["lote", "revocar-nodo", "revocar-lote"].includes(comando)) {
  console.error(uso);
  process.exit(2);
}

const config = cargarConfigOSalir("fabrica");
const log = crearLogger("fabrica", config.LOG_LEVEL);
if (values.dev && config.APP_ENV !== "local") {
  log.error("--dev solo se permite con APP_ENV=local");
  process.exit(1);
}

const db = new pg.Client({ connectionString: config.DATABASE_URL_MIGRATE });
const mqtt = crearClienteMqtt({
  url: config.MQTT_URL,
  username: config.MQTT_ADMIN_USER,
  password: config.MQTT_ADMIN_PASSWORD,
  clientId: `${config.MQTT_ADMIN_USER}-fabrica-${process.pid}`,
  caFile: config.MQTT_CA_FILE,
});

try {
  await db.connect();
  await esperarConexion(mqtt);
  const deps = { db, dynsec: new ClienteDynsec(mqtt), claimPepper: config.CLAIM_PEPPER };

  if (comando === "lote") {
    const cantidad = Number(values.cantidad);
    if (!values.cantidad || !Number.isInteger(cantidad)) {
      console.error(uso);
      process.exit(2);
    }
    const lote = await fabricarLote(deps, {
      cantidad,
      versionHw: values["version-hw"] as string,
      notas: values.notas,
      ...(values.dev ? { reclamarEn: DEV.espacioId } : {}),
    });

    const dir = resolve(values.salida as string, lote.loteId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "manifiesto.json"),
      `${JSON.stringify(
        {
          loteId: lote.loteId,
          creadoEn: lote.creadoEn,
          entorno: config.APP_ENV,
          cantidad: lote.nodos.length,
          versionHw: values["version-hw"],
          notas: values.notas ?? null,
          nodos: lote.nodos.map((n) => ({ deviceId: n.deviceId })),
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(dir, "identidades.json"),
      `${JSON.stringify({ loteId: lote.loteId, entorno: config.APP_ENV, nodos: lote.nodos }, null, 2)}\n`,
      { mode: 0o600 },
    );
    log.info({ loteId: lote.loteId, cantidad: lote.nodos.length, dir }, "lote fabricado");
    console.log(`Lote ${lote.loteId}: ${lote.nodos.length} nodos.\nArchivos en ${dir}`);
  } else if (comando === "revocar-nodo") {
    const id = positionals[0];
    if (!id) {
      console.error(uso);
      process.exit(2);
    }
    await revocarNodo(deps, id);
    console.log(`Nodo ${id} revocado.`);
  } else {
    const id = positionals[0];
    if (!id) {
      console.error(uso);
      process.exit(2);
    }
    const n = await revocarLote(deps, id);
    console.log(`Lote ${id} revocado (${n} nodos).`);
  }
} catch (error) {
  log.error({ err: error }, "factory falló");
  process.exitCode = 1;
} finally {
  await db.end().catch(() => undefined);
  await cerrarCliente(mqtt).catch(() => mqtt.end(true));
}
