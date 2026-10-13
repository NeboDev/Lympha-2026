import { lecturaApi } from "@lympha/contracts";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { BdApp } from "../../platform/db.ts";
import { NoEncontrado } from "../../platform/errors.ts";
import { type Autenticador, usuarioDe } from "../identidad/index.ts";
import { ultimasLecturas } from "./lectura-api.ts";

export interface DepsTelemetria {
  bd: BdApp;
  autenticar: Autenticador;
}

export const rutasTelemetria: FastifyPluginAsync<DepsTelemetria> = async (app, deps) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/api/nodos/:nodoId/lecturas",
    {
      preHandler: deps.autenticar,
      schema: {
        params: z.object({ nodoId: z.string().uuid() }),
        querystring: z.object({ limite: z.coerce.number().int().min(1).max(500).default(20) }),
        response: { 200: z.object({ lecturas: z.array(lecturaApi) }) },
      },
    },
    async (req) => {
      const lecturas = await ultimasLecturas(
        deps.bd,
        usuarioDe(req),
        req.params.nodoId,
        req.query.limite,
      );
      if (lecturas === null) throw new NoEncontrado();
      return { lecturas };
    },
  );
};
