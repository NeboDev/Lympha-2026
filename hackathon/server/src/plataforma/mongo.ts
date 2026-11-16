import dns from "node:dns";
import { type Db, MongoClient } from "mongodb";
import type { Config } from "../config.ts";

export type Mongo = {
  db: Db;
  ping(): Promise<boolean>;
  cerrar(): Promise<void>;
};

/** Única pieza que habla con MongoDB. */
export async function conectarMongo(config: Pick<Config, "mongoUri" | "mongoDb" | "mongoDns">) {
  if (config.mongoDns.length > 0) dns.setServers(config.mongoDns);
  const cliente = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
  await cliente.connect();
  const db = cliente.db(config.mongoDb);
  const mongo: Mongo = {
    db,
    async ping() {
      try {
        const r = await db.command({ ping: 1 });
        return r.ok === 1;
      } catch {
        return false;
      }
    },
    async cerrar() {
      await cliente.close();
    },
  };
  return mongo;
}
