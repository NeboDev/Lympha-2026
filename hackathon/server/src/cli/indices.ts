import { cargarConfig } from "../config.ts";
import { asegurarIndices } from "../plataforma/indices.ts";
import { conectarMongo } from "../plataforma/mongo.ts";

const config = cargarConfig(process.env);
const mongo = await conectarMongo(config);
try {
  const n = await asegurarIndices(mongo.db);
  console.log(`Índices asegurados: ${n} en la base «${config.mongoDb}».`);
} finally {
  await mongo.cerrar();
}
