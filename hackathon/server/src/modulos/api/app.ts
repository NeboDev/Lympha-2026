import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { registrarCors } from "./cors.ts";
import { type DependenciasSalud, rutaSalud } from "./salud.ts";

export type OpcionesApp = {
  corsOrigenes: string[];
  salud: DependenciasSalud;
  /** Instancia de pino ya configurada (con `redact`). Sin ella, no hay logs. */
  logger?: FastifyBaseLogger;
};

export function crearApp(opciones: OpcionesApp): FastifyInstance {
  const app = Fastify(opciones.logger ? { loggerInstance: opciones.logger } : { logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registrarCors(app, opciones.corsOrigenes);

  // Nunca se exponen trazas ni mensajes internos al cliente.
  app.setErrorHandler((error, req, reply) => {
    const codigo = (error as { statusCode?: number }).statusCode;
    if (codigo === 400) {
      return reply.code(400).send({ error: "peticion_invalida" });
    }
    req.log.error({ err: error }, "error no controlado");
    return reply.code(500).send({ error: "error_interno" });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "no_encontrado" }));

  rutaSalud(app, opciones.salud);
  return app;
}
