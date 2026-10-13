import {
  alarmaApi,
  canalEspacio,
  listaAlarmasQuery,
  listaAlarmasRespuesta,
} from "@lympha/contracts";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { type BdApp, conUsuario } from "../../platform/db.ts";
import { Conflicto, NoEncontrado } from "../../platform/errors.ts";
import type { Redis } from "../../platform/valkey.ts";
import { type Autenticador, exigirRol, usuarioDe } from "../identidad/index.ts";
import { atenderAlarma, listarAlarmas } from "./consulta.ts";

export interface DepsAlarmas {
  bd: BdApp;
  valkey: Redis;
  autenticar: Autenticador;
}

export const rutasAlarmas: FastifyPluginAsync<DepsAlarmas> = async (app, deps) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const opciones = { preHandler: deps.autenticar };

  // Historial del espacio con su estado y quién la atendió (RF-32). Un espacio ajeno responde 404.
  r.get(
    "/api/espacios/:espacioId/alarmas",
    {
      ...opciones,
      schema: {
        params: z.object({ espacioId: z.string().uuid() }),
        querystring: listaAlarmasQuery,
        response: { 200: listaAlarmasRespuesta },
      },
    },
    async (req) => {
      const { espacioId } = req.params;
      return conUsuario(deps.bd, usuarioDe(req), async (tx) => {
        await exigirRol(tx, espacioId, "miembro");
        return { alarmas: await listarAlarmas(tx, espacioId, req.query) };
      });
    },
  );

  // Cualquier miembro del espacio atiende. Una alarma ajena o inexistente: 404 idéntico; ya atendida o resuelta: 409.
  r.post(
    "/api/alarmas/:alarmaId/atender",
    {
      ...opciones,
      schema: {
        params: z.object({ alarmaId: z.string().uuid() }),
        response: { 200: alarmaApi },
      },
    },
    async (req) => {
      const resultado = await conUsuario(deps.bd, usuarioDe(req), (tx) =>
        atenderAlarma(tx, req.params.alarmaId),
      );
      if (resultado.tipo === "inexistente") throw new NoEncontrado();
      if (resultado.tipo === "no_activa") {
        throw new Conflicto("La alarma ya fue atendida o resuelta", "alarma_no_activa");
      }
      // Mejor esfuerzo: el stream del espacio se reconcilia con el snapshot al reconectar.
      await deps.valkey
        .publish(canalEspacio(resultado.evento.espacio_id), JSON.stringify(resultado.evento))
        .catch(() => undefined);
      return resultado.alarma;
    },
  );
};
