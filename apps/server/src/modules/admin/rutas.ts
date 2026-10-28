import {
  confirmarBody,
  crearLoteBody,
  listaLotesAdminRespuesta,
  listaNodosAdminQuery,
  listaNodosAdminRespuesta,
  loteCreadoRespuesta,
  nodoAdminDetalleApi,
  perteneceARespuesta,
  regenerarEtiquetaRespuesta,
  revocarLoteRespuesta,
} from "@lympha/contracts";
import { sql } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { type BdApp, conUsuario, type Tx } from "../../platform/db.ts";
import { NoAutenticado, NoEncontrado, ServicioNoDisponible } from "../../platform/errors.ts";
import {
  altaEnBroker,
  desactivarLoteEnBroker,
  desactivarNodoEnBroker,
  identidadNueva,
} from "../fabrica/index.ts";
import { type Autenticador, usuarioDe } from "../identidad/index.ts";
import type { ConBrokerAdmin } from "./broker.ts";
import { entregarEtiqueta } from "./etiquetas.ts";

export interface DepsAdmin {
  bd: BdApp;
  autenticar: Autenticador;
  claimPepper: string;
  /** Sin él (API sin credencial de administración del broker) las acciones que tocan el broker responden 503. */
  conBroker?: ConBrokerAdmin | undefined;
}

const iso = (d: Date | string | null): string | null =>
  d === null ? null : new Date(d).toISOString();
const sinGuiones = (codigo: string) => codigo.replaceAll("-", "");
const idNodo = z.object({ nodoId: z.string().uuid() });
const idLote = z.object({ loteId: z.string().uuid() });

type FilaNodo = {
  id: string;
  lote_id: string;
  estado: "fabricado" | "reclamado" | "activo" | "desvinculado" | "revocado";
  asignado: boolean;
  version_fw: string | null;
  creado_en: Date;
  reclamado_en: Date | null;
};

const nodoDeFila = (f: FilaNodo) => ({
  id: f.id,
  lote_id: f.lote_id,
  estado: f.estado,
  asignado: f.asignado,
  version_fw: f.version_fw,
  creado_en: iso(f.creado_en) as string,
  reclamado_en: iso(f.reclamado_en),
});

async function detalleNodo(tx: Tx, nodoId: string) {
  const r = await tx.execute<
    FilaNodo & {
      perfil_id: string;
      lote_creado_en: Date;
      lote_version_hw: string;
      lote_revocado_en: Date | null;
    }
  >(sql`SELECT * FROM app.admin_detalle_nodo(${nodoId})`);
  const f = r.rows[0];
  if (!f) throw new NoEncontrado();
  return f;
}

/**
 * Panel de administración de plataforma. TODA ruta responde 404 idéntico a una ruta inexistente a quien no esté en
 * `app.admins_plataforma` (también sin sesión y también con cuerpo inválido: el chequeo corre antes de validar).
 * Las funciones SQL vuelven a validar el rol por dentro. No hay ninguna ruta que devuelva datos de agua.
 */
export const rutasAdmin: FastifyPluginAsync<DepsAdmin> = async (app, deps) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function exigirAdmin(req: FastifyRequest) {
    try {
      await deps.autenticar(req);
    } catch (error) {
      if (error instanceof NoAutenticado) throw new NoEncontrado();
      throw error;
    }
    const res = await conUsuario(deps.bd, usuarioDe(req), (tx) =>
      tx.execute<{ ok: boolean }>(sql`SELECT app.es_admin_plataforma() AS ok`),
    );
    if (res.rows[0]?.ok !== true) throw new NoEncontrado();
  }
  const opciones = { preValidation: exigirAdmin };

  function broker(): ConBrokerAdmin {
    if (!deps.conBroker) {
      throw new ServicioNoDisponible(
        "La API no tiene configurado el acceso de administración al broker",
      );
    }
    return deps.conBroker;
  }

  r.get(
    "/api/admin/lotes",
    { ...opciones, schema: { response: { 200: listaLotesAdminRespuesta } } },
    async (req) => {
      const res = await conUsuario(deps.bd, usuarioDe(req), (tx) =>
        tx.execute<{
          id: string;
          creado_en: Date;
          cantidad: number;
          version_hw: string;
          notas: string | null;
          revocado_en: Date | null;
          fabricados: number;
          reclamados: number;
          activos: number;
          desvinculados: number;
          revocados: number;
        }>(sql`SELECT * FROM app.admin_listar_lotes()`),
      );
      return {
        lotes: res.rows.map((f) => ({
          id: f.id,
          creado_en: iso(f.creado_en) as string,
          cantidad: f.cantidad,
          version_hw: f.version_hw,
          notas: f.notas,
          revocado_en: iso(f.revocado_en),
          nodos: {
            fabricado: f.fabricados,
            reclamado: f.reclamados,
            activo: f.activos,
            desvinculado: f.desvinculados,
            revocado: f.revocados,
          },
        })),
      };
    },
  );

  // Crea el lote y entrega TODAS las etiquetas en esta respuesta (opción (a)): no se pueden volver a pedir.
  r.post(
    "/api/admin/lotes",
    {
      ...opciones,
      schema: { body: crearLoteBody, response: { 201: loteCreadoRespuesta } },
    },
    async (req, reply) => {
      const conBroker = broker();
      const { cantidad, version_hw: versionHw, notas } = req.body;
      const identidades = Array.from({ length: cantidad }, () => identidadNueva(""));

      const creado = await conUsuario(
        deps.bd,
        usuarioDe(req),
        async (tx) => {
          const res = await tx.execute<{
            lote_id: string;
            creado_en: Date;
            nodo_id: string;
            orden: number;
          }>(
            sql`SELECT * FROM app.admin_crear_lote(${versionHw}, ${notas ?? null}, ${`{${identidades
              .map((n) => sinGuiones(n.codigoReclamo))
              .join(",")}}`}::text[])`,
          );
          return res.rows;
        },
        { claimPepper: deps.claimPepper },
      );
      const loteId = creado[0]?.lote_id as string;
      const nodos = creado
        .toSorted((a, b) => a.orden - b.orden)
        .map((f, i) => ({
          ...(identidades[i] as (typeof identidades)[number]),
          deviceId: f.nodo_id,
        }));

      try {
        await conBroker((dynsec) => altaEnBroker(dynsec, loteId, nodos));
      } catch (error) {
        // El lote no llegó a existir del todo: se retira de la base (altaEnBroker ya deshizo el broker).
        await conUsuario(deps.bd, usuarioDe(req), (tx) =>
          tx.execute(sql`SELECT app.admin_deshacer_lote(${loteId})`),
        ).catch(() => undefined);
        throw error instanceof ServicioNoDisponible
          ? error
          : new ServicioNoDisponible("El broker rechazó el alta del lote; no se creó nada");
      }

      reply.header("cache-control", "no-store");
      return reply.code(201).send({
        lote_id: loteId,
        creado_en: iso(creado[0]?.creado_en as Date) as string,
        version_hw: versionHw,
        etiquetas: nodos.map((n) => entregarEtiqueta(n, loteId, versionHw)),
      });
    },
  );

  r.post(
    "/api/admin/lotes/:loteId/revocar",
    {
      ...opciones,
      schema: { params: idLote, body: confirmarBody, response: { 200: revocarLoteRespuesta } },
    },
    async (req) => {
      const { loteId } = req.params;
      const usuario = usuarioDe(req);
      const ids = await conUsuario(deps.bd, usuario, async (tx) => {
        const res = await tx.execute<{ admin_ids_lote: string }>(
          sql`SELECT app.admin_ids_lote(${loteId})`,
        );
        if (res.rows.length === 0) throw new NoEncontrado(); // todo lote tiene al menos un nodo
        return res.rows.map((f) => f.admin_ids_lote);
      });
      // Primero el broker (cierra la puerta); luego la base. Repetir la operación es seguro.
      await broker()((dynsec) => desactivarLoteEnBroker(dynsec, loteId, ids));
      const res = await conUsuario(deps.bd, usuario, (tx) =>
        tx.execute<{ n: number }>(sql`SELECT app.admin_revocar_lote(${loteId}) AS n`),
      );
      return { nodos_revocados: res.rows[0]?.n ?? 0 };
    },
  );

  r.get(
    "/api/admin/nodos",
    {
      ...opciones,
      schema: { querystring: listaNodosAdminQuery, response: { 200: listaNodosAdminRespuesta } },
    },
    async (req) => {
      const { lote, estado, q, limite, desplazamiento } = req.query;
      const res = await conUsuario(deps.bd, usuarioDe(req), (tx) =>
        tx.execute<FilaNodo & { total: string }>(
          sql`SELECT * FROM app.admin_listar_nodos(${lote ?? null}, ${estado ?? null}, ${q ?? null}, ${limite}, ${desplazamiento})`,
        ),
      );
      return { nodos: res.rows.map(nodoDeFila), total: Number(res.rows[0]?.total ?? 0) };
    },
  );

  r.get(
    "/api/admin/nodos/:nodoId",
    {
      ...opciones,
      schema: { params: idNodo, response: { 200: nodoAdminDetalleApi } },
    },
    async (req) => {
      const f = await conUsuario(deps.bd, usuarioDe(req), (tx) =>
        detalleNodo(tx, req.params.nodoId),
      );
      return {
        ...nodoDeFila(f),
        perfil_id: f.perfil_id,
        lote: {
          id: f.lote_id,
          creado_en: iso(f.lote_creado_en) as string,
          version_hw: f.lote_version_hw,
          revocado_en: iso(f.lote_revocado_en),
        },
      };
    },
  );

  // Soporte: a quién pertenece la boya. Cada llamada queda en app.auditoria (lo hace la función SQL).
  r.get(
    "/api/admin/nodos/:nodoId/pertenece-a",
    { ...opciones, schema: { params: idNodo, response: { 200: perteneceARespuesta } } },
    async (req, reply) => {
      const res = await conUsuario(deps.bd, usuarioDe(req), (tx) =>
        tx.execute<{
          nodo_id: string;
          espacio_id: string | null;
          espacio_nombre: string | null;
          propietario_id: string | null;
          propietario_email: string | null;
          propietario_nombre: string | null;
        }>(sql`SELECT * FROM app.admin_pertenece_a(${req.params.nodoId})`),
      );
      const f = res.rows[0];
      if (!f) throw new NoEncontrado();
      reply.header("cache-control", "no-store");
      return f;
    },
  );

  // Etiqueta nueva de un nodo aún "fabricado" (opción (b)). No se conserva la clave del AP ni la contraseña
  // MQTT, así que se rotan junto con el código: el nodo hay que volver a grabarlo con la identidad entregada.
  r.post(
    "/api/admin/nodos/:nodoId/regenerar-etiqueta",
    { ...opciones, schema: { params: idNodo, response: { 200: regenerarEtiquetaRespuesta } } },
    async (req, reply) => {
      const conBroker = broker();
      const { nodoId } = req.params;
      const usuario = usuarioDe(req);
      const nodo = identidadNueva(nodoId);
      // Primero la base: si el nodo ya no está "fabricado" se rechaza antes de tocar la contraseña del broker.
      const { loteId, versionHw } = await conUsuario(
        deps.bd,
        usuario,
        async (tx) => {
          const antes = await detalleNodo(tx, nodoId);
          await tx.execute(
            sql`SELECT app.admin_regenerar_nodo(${nodoId}, ${sinGuiones(nodo.codigoReclamo)})`,
          );
          return { loteId: antes.lote_id, versionHw: antes.lote_version_hw };
        },
        { claimPepper: deps.claimPepper },
      );
      await conBroker((dynsec) =>
        dynsec.comando({
          command: "setClientPassword",
          username: nodoId,
          password: nodo.mqttPassword,
        }),
      );
      reply.header("cache-control", "no-store");
      return { etiqueta: entregarEtiqueta(nodo, loteId, versionHw) };
    },
  );

  r.post(
    "/api/admin/nodos/:nodoId/revocar",
    { ...opciones, schema: { params: idNodo, body: confirmarBody } },
    async (req, reply) => {
      const { nodoId } = req.params;
      const usuario = usuarioDe(req);
      await conUsuario(deps.bd, usuario, (tx) => detalleNodo(tx, nodoId)); // 404 si no existe
      await broker()((dynsec) => desactivarNodoEnBroker(dynsec, nodoId));
      await conUsuario(deps.bd, usuario, (tx) =>
        tx.execute(sql`SELECT app.admin_revocar_nodo(${nodoId})`),
      );
      return reply.code(204).send();
    },
  );
};
