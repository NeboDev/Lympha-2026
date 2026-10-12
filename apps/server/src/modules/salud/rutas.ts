import { respuestaHealth } from "@lympha/contracts";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { type BaseDatos, pingPostgres } from "../../platform/db.ts";
import type { MqttClient } from "../../platform/mqtt.ts";
import { pingValkey, type Redis } from "../../platform/valkey.ts";

export interface DepsSalud {
  bd: BaseDatos;
  valkey: Redis;
  mqtt: MqttClient;
  version: string;
}

/** GET /health: 200 con Postgres, Valkey y MQTT conectados; 503 si falta alguno. */
export const rutasSalud: FastifyPluginAsync<DepsSalud> = async (app, deps) => {
  app
    .withTypeProvider<ZodTypeProvider>()
    .get(
      "/health",
      { schema: { response: { 200: respuestaHealth, 503: respuestaHealth } } },
      async (_req, reply) => {
        const [pg, vk] = await Promise.all([pingPostgres(deps.bd), pingValkey(deps.valkey)]);
        const componentes = {
          postgres: pg ? ("ok" as const) : ("error" as const),
          valkey: vk ? ("ok" as const) : ("error" as const),
          mqtt: deps.mqtt.connected ? ("ok" as const) : ("error" as const),
        };
        const sano = Object.values(componentes).every((c) => c === "ok");
        return reply
          .code(sano ? 200 : 503)
          .send({ estado: sano ? "ok" : "degradado", version: deps.version, componentes });
      },
    );
};
