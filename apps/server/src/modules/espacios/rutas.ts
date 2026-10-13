import {
  aceptarInvitacionBody,
  actualizarEspacioBody,
  crearEspacioBody,
  crearInvitacionRespuesta,
  espacioApi,
  espacioDetalleApi,
  transferirBody,
} from "@lympha/contracts";
import { sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { type BdApp, conUsuario } from "../../platform/db.ts";
import { Conflicto, NoEncontrado } from "../../platform/errors.ts";
import { consultarNodos } from "../dispositivos/index.ts";
import { type Autenticador, exigirRol, rolEnEspacio, usuarioDe } from "../identidad/index.ts";
import {
  aceptarInvitacion,
  actualizarEspacio,
  crearEspacio,
  crearInvitacion,
  listarEspacios,
  listarMiembros,
  obtenerEspacio,
  quitarMiembro,
  transferirPropiedad,
} from "./repo.ts";

export interface DepsEspacios {
  bd: BdApp;
  autenticar: Autenticador;
}

const idEspacio = z.object({ espacioId: z.string().uuid() });

export const rutasEspacios: FastifyPluginAsync<DepsEspacios> = async (app, deps) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const opciones = { preHandler: deps.autenticar };

  r.post(
    "/api/espacios",
    { ...opciones, schema: { body: crearEspacioBody, response: { 201: espacioApi } } },
    async (req, reply) => {
      const espacio = await conUsuario(deps.bd, usuarioDe(req), (tx) => crearEspacio(tx, req.body));
      return reply.code(201).send(espacio);
    },
  );

  r.get(
    "/api/espacios",
    { ...opciones, schema: { response: { 200: z.object({ espacios: z.array(espacioApi) }) } } },
    async (req) => ({
      espacios: await conUsuario(deps.bd, usuarioDe(req), (tx) => listarEspacios(tx)),
    }),
  );

  r.get(
    "/api/espacios/:espacioId",
    { ...opciones, schema: { params: idEspacio, response: { 200: espacioDetalleApi } } },
    async (req) => {
      const detalle = await conUsuario(deps.bd, usuarioDe(req), async (tx) => {
        const espacio = await obtenerEspacio(tx, req.params.espacioId);
        if (!espacio) return null;
        return {
          espacio,
          miembros: await listarMiembros(tx, req.params.espacioId),
          nodos: await consultarNodos(tx, sql`n.espacio_id = ${req.params.espacioId}`),
        };
      });
      if (!detalle) throw new NoEncontrado();
      return detalle;
    },
  );

  r.patch(
    "/api/espacios/:espacioId",
    {
      ...opciones,
      schema: { params: idEspacio, body: actualizarEspacioBody, response: { 200: espacioApi } },
    },
    async (req) => {
      const espacio = await conUsuario(deps.bd, usuarioDe(req), async (tx) => {
        await exigirRol(tx, req.params.espacioId, "propietario");
        await actualizarEspacio(tx, req.params.espacioId, req.body);
        return obtenerEspacio(tx, req.params.espacioId);
      });
      if (!espacio) throw new NoEncontrado();
      return espacio;
    },
  );

  r.post(
    "/api/espacios/:espacioId/invitaciones",
    { ...opciones, schema: { params: idEspacio, response: { 201: crearInvitacionRespuesta } } },
    async (req, reply) => {
      const invitacion = await conUsuario(deps.bd, usuarioDe(req), async (tx) => {
        await exigirRol(tx, req.params.espacioId, "propietario");
        return crearInvitacion(tx, req.params.espacioId);
      });
      return reply.code(201).send(invitacion);
    },
  );

  // La invitación no está ligada a un espacio de la URL: quien tiene el token todavía no es miembro.
  r.post(
    "/api/invitaciones/aceptar",
    {
      ...opciones,
      schema: {
        body: aceptarInvitacionBody,
        response: { 200: z.object({ espacio_id: z.string().uuid() }) },
      },
    },
    async (req) => ({
      espacio_id: await conUsuario(deps.bd, usuarioDe(req), (tx) =>
        aceptarInvitacion(tx, req.body.token),
      ),
    }),
  );

  r.delete(
    "/api/espacios/:espacioId/miembros/:usuarioId",
    { ...opciones, schema: { params: idEspacio.extend({ usuarioId: z.string().uuid() }) } },
    async (req, reply) => {
      const yo = usuarioDe(req);
      await conUsuario(deps.bd, yo, async (tx) => {
        const rol = await rolEnEspacio(tx, req.params.espacioId);
        if (rol === null) throw new NoEncontrado();
        // Un miembro solo puede salirse a sí mismo; el propietario quita a cualquiera menos a sí mismo.
        if (rol === "miembro" && req.params.usuarioId !== yo) {
          await exigirRol(tx, req.params.espacioId, "propietario");
        }
        if (rol === "propietario" && req.params.usuarioId === yo) {
          throw new Conflicto(
            "Transfiere la propiedad antes de salir del espacio",
            "transferir_primero",
          );
        }
        if (!(await quitarMiembro(tx, req.params.espacioId, req.params.usuarioId))) {
          throw new NoEncontrado();
        }
      });
      return reply.code(204).send();
    },
  );

  r.post(
    "/api/espacios/:espacioId/transferir",
    { ...opciones, schema: { params: idEspacio, body: transferirBody } },
    async (req, reply) => {
      await conUsuario(deps.bd, usuarioDe(req), async (tx) => {
        await exigirRol(tx, req.params.espacioId, "propietario");
        await transferirPropiedad(tx, req.params.espacioId, req.body.usuarioId);
      });
      return reply.code(204).send();
    },
  );
};
