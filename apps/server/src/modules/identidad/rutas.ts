import { actualizarUsuarioBody, usuarioApi } from "@lympha/contracts";
import { sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { type BdApp, conUsuario } from "../../platform/db.ts";
import { NoAutenticado } from "../../platform/errors.ts";
import { type Autenticador, usuarioDe } from "./autenticacion.ts";

export interface DepsIdentidad {
  bd: BdApp;
  autenticar: Autenticador;
}

export const rutasIdentidad: FastifyPluginAsync<DepsIdentidad> = async (app, deps) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const opciones = { preHandler: deps.autenticar };

  r.get("/api/yo", { ...opciones, schema: { response: { 200: usuarioApi } } }, async (req) => {
    const fila = await conUsuario(deps.bd, usuarioDe(req), async (tx) => {
      const res = await tx.execute<{
        id: string;
        email: string;
        nombre: string | null;
        es_admin: boolean;
      }>(
        sql`SELECT id, email::text AS email, nombre, app.es_admin_plataforma() AS es_admin
            FROM app.usuarios WHERE id = app.usuario_actual()`,
      );
      return res.rows[0];
    });
    if (!fila) throw new NoAutenticado();
    return fila;
  });

  r.patch(
    "/api/yo",
    { ...opciones, schema: { body: actualizarUsuarioBody, response: { 200: usuarioApi } } },
    async (req) => {
      const fila = await conUsuario(deps.bd, usuarioDe(req), async (tx) => {
        const res = await tx.execute<{
          id: string;
          email: string;
          nombre: string | null;
          es_admin: boolean;
        }>(
          sql`UPDATE app.usuarios SET nombre = ${req.body.nombre}
              WHERE id = app.usuario_actual()
              RETURNING id, email::text AS email, nombre, app.es_admin_plataforma() AS es_admin`,
        );
        return res.rows[0];
      });
      if (!fila) throw new NoAutenticado();
      return fila;
    },
  );

  // Borra al usuario y lo que solo existía por él (RNF-06). La cuenta de Firebase se borra aparte, desde el cliente.
  r.delete("/api/yo", opciones, async (req, reply) => {
    const yo = usuarioDe(req);
    await conUsuario(deps.bd, yo, (tx) => tx.execute(sql`SELECT app.eliminar_mi_cuenta()`));
    deps.autenticar.olvidar(yo);
    return reply.code(204).send();
  });
};
