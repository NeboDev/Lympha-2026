import { randomUUID } from "node:crypto";
import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { esErrorDominio, traducirErrorPg } from "./errors.ts";
import type { Logger } from "./logger.ts";

/**
 * Servidor HTTP base: validación y serialización con Zod y traducción de errores de dominio a
 * códigos HTTP. Nunca se exponen trazas ni mensajes internos al cliente.
 */
export function crearServidorHttp(
  log: Logger,
  opciones: { origenesCors?: readonly string[] } = {},
): FastifyInstance {
  const origenesCors = new Set(opciones.origenesCors ?? []);
  const app = Fastify({
    loggerInstance: log as unknown as FastifyBaseLogger,
    genReqId: (req) => {
      const entrante = req.headers["x-request-id"];
      return typeof entrante === "string" && /^[\w-]{1,64}$/.test(entrante)
        ? entrante
        : randomUUID();
    },
    trustProxy: true, // detrás de Caddy
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // CORS: la PWA vive en otro origen (app.<dominio>). Solo se responde a los orígenes configurados y sin
  // credenciales (el acceso es con `Authorization: Bearer`, no con cookies). Un origen ajeno no recibe cabeceras
  // CORS y el navegador bloquea la respuesta; la API no cambia su comportamiento para quien no es navegador.
  app.addHook("onRequest", async (req, reply) => {
    reply.header("vary", "Origin");
    const origen = req.headers.origin;
    if (typeof origen !== "string" || !origenesCors.has(origen)) return;
    reply.header("access-control-allow-origin", origen);
    reply.header("access-control-expose-headers", "x-request-id");
    if (req.method === "OPTIONS" && req.headers["access-control-request-method"]) {
      reply
        .header("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE")
        .header("access-control-allow-headers", "authorization, content-type")
        .header("access-control-max-age", "600")
        .code(204)
        .send();
      return reply;
    }
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ codigo: "no_encontrado", mensaje: "No encontrado" });
  });

  app.setErrorHandler((error: FastifyError | Error, req, reply) => {
    if (esErrorDominio(error)) {
      return reply.code(error.status).send({ codigo: error.codigo, mensaje: error.message });
    }
    const deLaBase = traducirErrorPg(error);
    if (deLaBase)
      return reply
        .code(deLaBase.status)
        .send({ codigo: deLaBase.codigo, mensaje: deLaBase.message });
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({ codigo: "invalido", mensaje: "Solicitud inválida" });
    }
    const status = (error as FastifyError).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ codigo: "invalido", mensaje: "Solicitud inválida" });
    }
    req.log.error({ err: error }, "error no controlado");
    return reply.code(500).send({ codigo: "error_interno", mensaje: "Error interno" });
  });

  return app;
}
