import { cargarConfig } from "./config.ts";
import { crearApp } from "./modulos/api/index.ts";
import { blynkAlcanzable } from "./plataforma/blynk.ts";
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

async function apagar(senal: string) {
  logger.info({ senal }, "apagando");
  await app.close();
  await mongo.cerrar();
  process.exit(0);
}
process.on("SIGINT", () => void apagar("SIGINT"));
process.on("SIGTERM", () => void apagar("SIGTERM"));

await app.listen({ port: config.puerto, host: "0.0.0.0" });
logger.info({ puerto: config.puerto, env: config.appEnv }, "Atl listo");
