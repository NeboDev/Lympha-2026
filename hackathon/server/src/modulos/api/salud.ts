import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export type DependenciasSalud = {
  mongo: () => Promise<boolean>;
  blynk: () => Promise<boolean>;
};

const respuesta = z.object({ ok: z.boolean(), mongo: z.boolean(), blynk: z.boolean() });

/** GET /api/salud — pública. Siempre 200: el estado va en el cuerpo para el jurado y los chequeos. */
export function rutaSalud(app: FastifyInstance, deps: DependenciasSalud) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .get("/api/salud", { schema: { response: { 200: respuesta } } }, async () => {
      const [mongo, blynk] = await Promise.all([
        deps.mongo().catch(() => false),
        deps.blynk().catch(() => false),
      ]);
      return { ok: mongo && blynk, mongo, blynk };
    });
}
