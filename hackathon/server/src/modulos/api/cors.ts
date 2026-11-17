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
      // Sin esto el navegador no deja leer el nombre del PDF desde otra origen (la web en :5173).
      reply.header("Access-Control-Expose-Headers", "Content-Disposition");
      reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });
}
