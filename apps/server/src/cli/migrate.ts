// Job de migraciones: corre con DATABASE_URL_MIGRATE (lympha_owner), solo en el despliegue.
import { cargarConfigOSalir } from "../platform/config.ts";
import { crearLogger } from "../platform/logger.ts";
import { migrar } from "../platform/migrar.ts";

const config = cargarConfigOSalir("migrate");
const log = crearLogger("migrate", config.LOG_LEVEL);

try {
  const r = await migrar(config.DATABASE_URL_MIGRATE, (n) =>
    log.info({ migracion: n }, "aplicada"),
  );
  log.info(
    { aplicadas: r.aplicadas.length, yaAplicadas: r.yaAplicadas.length },
    "migraciones al día",
  );
} catch (error) {
  log.error({ err: error }, "migración fallida");
  process.exit(1);
}
