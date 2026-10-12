import { lecturaApi } from "@lympha/contracts";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { BdApp } from "../../platform/db.ts";
import { NoEncontrado } from "../../platform/errors.ts";
import { ultimasLecturas } from "./lectura-api.ts";

/**
 * Endpoint de prueba SOLO para desarrollo local (APP_ENV=local): hasta que llegue la verificación
 * de Firebase (H1), el usuario se indica con la cabecera `x-dev-usuario-id`. Aun así lee por
 * conUsuario() y app.v_lecturas: es la misma ruta de aislamiento que usará la API real.
 */
export const rutasDevTelemetria: FastifyPluginAsync<{ bd: BdApp }> = async (app, opciones) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/dev/nodos/:nodoId/lecturas",
    {
      schema: {
        headers: z.object({ "x-dev-usuario-id": z.string().uuid() }),
        params: z.object({ nodoId: z.string().uuid() }),
        querystring: z.object({ limite: z.coerce.number().int().min(1).max(500).default(20) }),
        response: { 200: z.object({ lecturas: z.array(lecturaApi) }) },
      },
    },
    async (req) => {
      const lecturas = await ultimasLecturas(
        opciones.bd,
        req.headers["x-dev-usuario-id"],
        req.params.nodoId,
        req.query.limite,
      );
      if (lecturas === null) throw new NoEncontrado();
      return { lecturas };
    },
  );
};
