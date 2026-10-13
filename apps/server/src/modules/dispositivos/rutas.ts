import {
  actualizarNodoBody,
  nodoApi,
  normalizarCodigoReclamo,
  reclamarNodoBody,
} from "@lympha/contracts";
import { sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { type BdApp, conUsuario, type Tx } from "../../platform/db.ts";
import { DemasiadasSolicitudes, NoEncontrado, ReclamoInvalido } from "../../platform/errors.ts";
import type { Redis } from "../../platform/valkey.ts";
import { type Autenticador, exigirRol, usuarioDe } from "../identidad/index.ts";
import { consultarNodos } from "./consulta.ts";
import { CANAL_INVALIDAR_NODO } from "./resolver.ts";

export interface DepsDispositivos {
  bd: BdApp;
  valkey: Redis;
  autenticar: Autenticador;
  claimPepper: string;
}

const idNodo = z.object({ nodoId: z.string().uuid() });

const MAX_FALLOS = 10;
const VENTANA_S = 15 * 60;

/** Frena la prueba de códigos de reclamo: 10 fallos cada 15 minutos por usuario (clave `rl:*`). */
async function exigirCupoDeReclamo(valkey: Redis, usuarioId: string): Promise<void> {
  const fallos = Number((await valkey.get(`rl:reclamar:${usuarioId}`)) ?? 0);
  if (fallos >= MAX_FALLOS) throw new DemasiadasSolicitudes();
}

async function registrarFallo(valkey: Redis, usuarioId: string): Promise<void> {
  const clave = `rl:reclamar:${usuarioId}`;
  const n = await valkey.incr(clave);
  if (n === 1) await valkey.expire(clave, VENTANA_S);
}

/** Espacio del nodo si el usuario lo ve; `null` si no existe o es ajeno (mismo 404). */
async function espacioDelNodo(tx: Tx, nodoId: string): Promise<string | null> {
  const r = await tx.execute<{ espacio_id: string | null }>(
    sql`SELECT espacio_id FROM app.nodos WHERE id = ${nodoId}`,
  );
  return r.rows[0]?.espacio_id ?? null;
}

export const rutasDispositivos: FastifyPluginAsync<DepsDispositivos> = async (app, deps) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const opciones = { preHandler: deps.autenticar };
  const invalidar = (nodoId: string) => deps.valkey.publish(CANAL_INVALIDAR_NODO, nodoId);

  // Reclamo (RF de alta): el código de la etiqueta liga el nodo al espacio. Todos los fallos devuelven el
  // mismo 404 para no revelar si el nodo existe, y los intentos fallidos se limitan por usuario.
  r.post(
    "/api/nodos/reclamar",
    { ...opciones, schema: { body: reclamarNodoBody, response: { 200: nodoApi } } },
    async (req) => {
      const yo = usuarioDe(req);
      await exigirCupoDeReclamo(deps.valkey, yo);
      const { nodoId, espacioId, perfilId } = req.body;
      const codigo = normalizarCodigoReclamo(req.body.codigo);
      try {
        const nodo = await conUsuario(
          deps.bd,
          yo,
          async (tx) => {
            await exigirRol(tx, espacioId, "propietario");
            await tx.execute(
              sql`SELECT app.reclamar_nodo(${nodoId}, ${codigo}, ${espacioId}, ${perfilId})`,
            );
            return (await consultarNodos(tx, sql`n.id = ${nodoId}`))[0];
          },
          { claimPepper: deps.claimPepper },
        );
        if (!nodo) throw new NoEncontrado();
        await invalidar(nodoId);
        return nodo;
      } catch (error) {
        if (
          error instanceof NoEncontrado ||
          error instanceof ReclamoInvalido ||
          esReclamoFallido(error)
        ) {
          await registrarFallo(deps.valkey, yo);
        }
        throw error;
      }
    },
  );

  r.get(
    "/api/nodos/:nodoId",
    { ...opciones, schema: { params: idNodo, response: { 200: nodoApi } } },
    async (req) => {
      const nodo = await conUsuario(deps.bd, usuarioDe(req), async (tx) => {
        return (await consultarNodos(tx, sql`n.id = ${req.params.nodoId}`))[0];
      });
      if (!nodo) throw new NoEncontrado();
      return nodo;
    },
  );

  r.patch(
    "/api/nodos/:nodoId",
    {
      ...opciones,
      schema: { params: idNodo, body: actualizarNodoBody, response: { 200: nodoApi } },
    },
    async (req) => {
      const { nombre, perfilId } = req.body;
      const nodo = await conUsuario(deps.bd, usuarioDe(req), async (tx) => {
        const espacioId = await espacioDelNodo(tx, req.params.nodoId);
        if (!espacioId) throw new NoEncontrado();
        await exigirRol(tx, espacioId, "propietario");
        const cambios = [
          nombre !== undefined ? sql`nombre = ${nombre}` : null,
          perfilId !== undefined ? sql`perfil_id = ${perfilId}` : null,
        ].filter((c) => c !== null);
        await tx.execute(
          sql`UPDATE app.nodos SET ${sql.join(cambios, sql`, `)} WHERE id = ${req.params.nodoId}`,
        );
        return (await consultarNodos(tx, sql`n.id = ${req.params.nodoId}`))[0];
      });
      if (!nodo) throw new NoEncontrado();
      if (perfilId !== undefined) await invalidar(req.params.nodoId);
      return nodo;
    },
  );

  r.post(
    "/api/nodos/:nodoId/desvincular",
    { ...opciones, schema: { params: idNodo } },
    async (req, reply) => {
      await conUsuario(deps.bd, usuarioDe(req), async (tx) => {
        const espacioId = await espacioDelNodo(tx, req.params.nodoId);
        if (!espacioId) throw new NoEncontrado();
        await exigirRol(tx, espacioId, "propietario");
        await tx.execute(sql`SELECT app.desvincular_nodo(${req.params.nodoId})`);
      });
      await invalidar(req.params.nodoId);
      return reply.code(204).send();
    },
  );
};

/** `reclamar_nodo` lanza P0001 `reclamo_invalido`, que la capa HTTP traduce; aquí solo se detecta para limitar. */
function esReclamoFallido(error: unknown): boolean {
  let actual: unknown = error;
  for (let i = 0; i < 5 && actual instanceof Error; i++) {
    if (actual.message === "reclamo_invalido") return true;
    actual = actual.cause;
  }
  return false;
}
