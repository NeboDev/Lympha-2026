import { cargarConfig } from "./config.ts";
import { crearApp } from "./modulos/api/index.ts";
import { crearIngesta, crearPoller } from "./modulos/ingesta/index.ts";
import { crearAlmacenMongo } from "./plataforma/almacen-mongo.ts";
import { blynkAlcanzable } from "./plataforma/blynk.ts";
import { cargarCatalogo } from "./plataforma/catalogo.ts";
import { crearLectorBlynk } from "./plataforma/lector-blynk.ts";
import { crearLogger } from "./plataforma/logger.ts";
import { conectarMongo } from "./plataforma/mongo.ts";

const config = cargarConfig(process.env);
const logger = crearLogger();

const mongo = await conectarMongo(config);
const app = crearApp({
  corsOrigenes: config.corsOrigenes,
  salud: {
    mongo: () => mongo.ping(),
    blynk: () => blynkAlcanzable(config.blynkHost),
  },
  logger,
});

// Poller de Blynk → Mongo. Se puede apagar con INGESTA_ACTIVA=false (solo API).
const almacen = crearAlmacenMongo(mongo.db);
const poller = config.ingestaActiva
  ? crearPoller({
      ingesta: crearIngesta({
        almacen,
        lector: crearLectorBlynk({ clave: config.claveCifrado }),
        catalogo: cargarCatalogo(),
        sinDatosS: config.sinDatosS,
        logger,
      }),
      almacen,
      pollMs: config.pollMs,
      logger,
    })
  : null;

async function apagar(senal: string) {
  logger.info({ senal }, "apagando");
  await poller?.detener();
  await app.close();
  await mongo.cerrar();
  process.exit(0);
}
process.on("SIGINT", () => void apagar("SIGINT"));
process.on("SIGTERM", () => void apagar("SIGTERM"));

await app.listen({ port: config.puerto, host: "0.0.0.0" });
poller?.iniciar();
logger.info(
  {
    puerto: config.puerto,
    env: config.appEnv,
    ingesta: config.ingestaActiva,
    poll_ms: config.pollMs,
  },
  "Atl listo",
);
