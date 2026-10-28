import { advertencias, calcularRegresion, ErrorCalibracion, IDENTIDAD } from "@lympha/calibracion";
import {
  type CalibracionApi,
  calibracionApi,
  canalEspacio,
  crearCalibracionBody,
  type EventoCalibracion,
  listaCalibracionesQuery,
  listaCalibracionesRespuesta,
  restablecerCalibracionBody,
} from "@lympha/contracts";
import { sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { type BdApp, conUsuario, type Tx } from "../../platform/db.ts";
import { ErrorDominio, NoEncontrado } from "../../platform/errors.ts";
import type { Redis } from "../../platform/valkey.ts";
import { type Autenticador, exigirRol, usuarioDe } from "../identidad/index.ts";
import { CANAL_INVALIDAR_CALIBRACION } from "./cache.ts";
import { calibracionPorId, listarCalibraciones } from "./consulta.ts";

export interface DepsCalibracion {
  bd: BdApp;
  valkey: Redis;
  autenticar: Autenticador;
}

/** Puntos que no dan una recta válida (poca variación, sensor invertido…): 422 con el motivo para la persona. */
class CalibracionInvalida extends ErrorDominio {
  constructor(codigo: string, mensaje: string) {
    super(codigo, mensaje, 422);
  }
}

async function espacioDelNodo(tx: Tx, nodoId: string): Promise<string> {
  const r = await tx.execute<{ espacio_id: string | null }>(
    sql`SELECT espacio_id FROM app.nodos WHERE id = ${nodoId}`,
  );
  const espacio = r.rows[0]?.espacio_id;
  if (!espacio) throw new NoEncontrado();
  return espacio;
}

export const rutasCalibracion: FastifyPluginAsync<DepsCalibracion> = async (app, deps) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const opciones = { preHandler: deps.autenticar };

  /** Avisa al worker (caché de coeficientes) y a la PWA del espacio. Mejor esfuerzo: la caché caduca sola. */
  async function difundir(c: CalibracionApi, cambio: EventoCalibracion["cambio"]) {
    const evento: EventoCalibracion = {
      calibracion_id: c.id,
      nodo_id: c.nodo_id,
      espacio_id: c.espacio_id,
      parametro: c.parametro,
      cambio,
      pendiente: c.pendiente,
      desfase: c.desfase,
      actualizado_en: new Date().toISOString(),
    };
    await deps.valkey.publish(CANAL_INVALIDAR_CALIBRACION, c.nodo_id).catch(() => undefined);
    await deps.valkey
      .publish(canalEspacio(c.espacio_id), JSON.stringify(evento))
      .catch(() => undefined);
  }

  // Historial del nodo (cualquier miembro lo lee). Un nodo ajeno o inexistente responde 404.
  r.get(
    "/api/calibraciones",
    {
      ...opciones,
      schema: {
        querystring: listaCalibracionesQuery,
        response: { 200: listaCalibracionesRespuesta },
      },
    },
    async (req) =>
      conUsuario(deps.bd, usuarioDe(req), async (tx) => {
        const espacioId = await espacioDelNodo(tx, req.query.nodo_id);
        await exigirRol(tx, espacioId, "miembro");
        const calibraciones = await listarCalibraciones(
          tx,
          req.query.nodo_id,
          req.query.parametro,
          req.query.limite,
        );
        return { calibraciones };
      }),
  );

  // Guarda una calibración nueva y la deja activa. La recta se calcula aquí, a partir de los puntos.
  r.post(
    "/api/calibraciones",
    { ...opciones, schema: { body: crearCalibracionBody, response: { 201: calibracionApi } } },
    async (req, reply) => {
      let regresion: ReturnType<typeof calcularRegresion>;
      try {
        regresion = calcularRegresion(req.body.puntos);
      } catch (error) {
        if (error instanceof ErrorCalibracion) {
          throw new CalibracionInvalida(error.codigo, error.message);
        }
        throw error;
      }
      const { nodo_id, parametro, puntos } = req.body;
      const guardada = await conUsuario(deps.bd, usuarioDe(req), async (tx) => {
        const espacioId = await espacioDelNodo(tx, nodo_id);
        await exigirRol(tx, espacioId, "propietario");
        const id = await tx.execute<{ id: string }>(sql`
          SELECT app.registrar_calibracion(${nodo_id}, ${parametro}, ${regresion.pendiente},
            ${regresion.desfase}, ${regresion.r2}, ${JSON.stringify(puntos)}::jsonb, 'guiada') AS id`);
        const fila = id.rows[0];
        return fila ? calibracionPorId(tx, fila.id) : null;
      });
      if (!guardada) throw new NoEncontrado();
      await difundir(guardada, "registrada");
      return reply.code(201).send({ ...guardada, advertencias: advertencias(regresion) });
    },
  );

  // Vuelve a la identidad (pendiente 1, desfase 0): las lecturas nuevas dejan de corregirse.
  r.post(
    "/api/calibraciones/restablecer",
    {
      ...opciones,
      schema: { body: restablecerCalibracionBody, response: { 201: calibracionApi } },
    },
    async (req, reply) => {
      const { nodo_id, parametro } = req.body;
      const guardada = await conUsuario(deps.bd, usuarioDe(req), async (tx) => {
        const espacioId = await espacioDelNodo(tx, nodo_id);
        await exigirRol(tx, espacioId, "propietario");
        const id = await tx.execute<{ id: string }>(sql`
          SELECT app.registrar_calibracion(${nodo_id}, ${parametro}, ${IDENTIDAD.pendiente},
            ${IDENTIDAD.desfase}, NULL, '[]'::jsonb, 'identidad') AS id`);
        const fila = id.rows[0];
        return fila ? calibracionPorId(tx, fila.id) : null;
      });
      if (!guardada) throw new NoEncontrado();
      await difundir(guardada, "restablecida");
      return reply.code(201).send(guardada);
    },
  );

  // Revertir: vuelve a dejar activa una calibración del historial (la anterior, p. ej.).
  r.post(
    "/api/calibraciones/:calibracionId/activar",
    {
      ...opciones,
      schema: {
        params: z.object({ calibracionId: z.string().uuid() }),
        response: { 200: calibracionApi },
      },
    },
    async (req) => {
      const activada = await conUsuario(deps.bd, usuarioDe(req), async (tx) => {
        const actual = await calibracionPorId(tx, req.params.calibracionId);
        if (!actual) throw new NoEncontrado();
        await exigirRol(tx, actual.espacio_id, "propietario");
        await tx.execute(sql`SELECT * FROM app.activar_calibracion(${req.params.calibracionId})`);
        return calibracionPorId(tx, req.params.calibracionId);
      });
      if (!activada) throw new NoEncontrado();
      await difundir(activada, "revertida");
      return activada;
    },
  );
};
