import type { FastifyInstance } from "fastify";

/** CORS mínimo y explícito: solo los orígenes de `CORS_ORIGINS` (sin dependencia extra). */
export function registrarCors(app: FastifyInstance, origenes: string[]) {
  const permitidos = new Set(origenes);
  app.addHook("onRequest", async (req, reply) => {
    const origen = req.headers.origin;
    if (origen && permitidos.has(origen)) {
      reply.header("Access-Control-Allow-Origin", origen);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
      reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });
}
