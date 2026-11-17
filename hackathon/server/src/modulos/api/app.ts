import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { ErrorDominio } from "../../dominio/errores.ts";
import { registrarCors } from "./cors.ts";
import { registrarRutas, type ServiciosApi } from "./rutas.ts";
import { type DependenciasSalud, rutaSalud } from "./salud.ts";

export type OpcionesApp = {
  corsOrigenes: string[];
  salud: DependenciasSalud;
  /** Rutas de usuario (todo menos `/api/salud`). Sin esto, la API solo contesta la salud. */
  servicios?: ServiciosApi;
  /** Instancia de pino ya configurada (con `redact`). Sin ella, no hay logs. */
  logger?: FastifyBaseLogger;
  /** Solo para pruebas: se llama con cada ruta que se registra (método y URL). */
  observarRutas?: (metodo: string, url: string) => void;
};

export function crearApp(opciones: OpcionesApp): FastifyInstance {
  const app = Fastify(opciones.logger ? { loggerInstance: opciones.logger } : { logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Debe registrarse antes que las rutas para verlas todas.
  const observar = opciones.observarRutas;
  if (observar) {
    app.addHook("onRoute", (ruta) => {
      for (const metodo of [ruta.method].flat()) {
        if (metodo !== "HEAD" && metodo !== "OPTIONS") observar(metodo, ruta.url);
      }
    });
  }

  registrarCors(app, opciones.corsOrigenes);

  // Nunca se exponen trazas ni mensajes internos al cliente: solo el código de un error de dominio.
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ErrorDominio) {
      if (error.estado === 401) reply.header("WWW-Authenticate", "Bearer");
      return reply.code(error.estado).send({ error: error.codigo, mensaje: error.message });
    }
    const codigo = (error as { statusCode?: number }).statusCode;
    if (codigo === 400) {
      return reply.code(400).send({ error: "peticion_invalida" });
    }
    if (codigo === 413) {
      return reply.code(413).send({ error: "peticion_muy_grande" });
    }
    req.log.error({ err: error }, "error no controlado");
    return reply.code(500).send({ error: "error_interno" });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "no_encontrado" }));

  rutaSalud(app, opciones.salud);
  if (opciones.servicios) registrarRutas(app, opciones.servicios);
  return app;
}
