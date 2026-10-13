import {
  estadoTelegramApi,
  preferenciaBody,
  preferenciasRespuesta,
  vinculoTelegramRespuesta,
} from "@lympha/contracts";
import { sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { type BdApp, conUsuario } from "../../platform/db.ts";
import { DemasiadasSolicitudes, ErrorDominio, NoEncontrado } from "../../platform/errors.ts";
import type { Redis } from "../../platform/valkey.ts";
import { type Autenticador, usuarioDe } from "../identidad/index.ts";
import {
  borrarPreferenciaDeNodo,
  guardarPreferencia,
  leerPreferencias,
  nodoVisible,
} from "./preferencias.ts";
import { crearTokenVinculo, enlaceDeVinculo } from "./vinculo.ts";

export interface DepsNotificaciones {
  bd: BdApp;
  valkey: Redis;
  autenticar: Autenticador;
  /** Nombre de usuario del bot. Ausente si el bot no está configurado (sin TELEGRAM_BOT_TOKEN). */
  nombreBot?: () => Promise<string>;
}

class TelegramNoDisponible extends ErrorDominio {
  constructor() {
    super("telegram_no_disponible", "Los avisos por Telegram no están disponibles ahora", 503);
  }
}

/** Enlaces pedidos por usuario en una ventana: acota el abuso sin estorbar a quien reintenta. */
const MAX_VINCULOS = 10;
const VENTANA_VINCULOS_S = 900;

export const rutasNotificaciones: FastifyPluginAsync<DepsNotificaciones> = async (app, deps) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const opciones = { preHandler: deps.autenticar };

  r.post(
    "/api/yo/telegram/vinculo",
    { ...opciones, schema: { response: { 201: vinculoTelegramRespuesta } } },
    async (req, reply) => {
      if (!deps.nombreBot) throw new TelegramNoDisponible();
      const usuarioId = usuarioDe(req);
      const clave = `rl:vinculo:${usuarioId}`;
      const n = await deps.valkey.incr(clave);
      if (n === 1) await deps.valkey.expire(clave, VENTANA_VINCULOS_S);
      if (n > MAX_VINCULOS) throw new DemasiadasSolicitudes();

      let bot: string;
      try {
        bot = await deps.nombreBot();
      } catch {
        throw new TelegramNoDisponible();
      }
      const { token, expiraEn } = await crearTokenVinculo(deps.valkey, usuarioId);
      return reply
        .code(201)
        .send({ enlace: enlaceDeVinculo(bot, token), expira_en: expiraEn.toISOString() });
    },
  );

  r.get(
    "/api/yo/telegram",
    { ...opciones, schema: { response: { 200: estadoTelegramApi } } },
    async (req) => {
      const fila = await conUsuario(deps.bd, usuarioDe(req), async (tx) => {
        const x = await tx.execute<{ vinculado_en: Date }>(
          sql`SELECT vinculado_en FROM app.vinculos_telegram WHERE usuario_id = app.usuario_actual()`,
        );
        return x.rows[0];
      });
      return {
        vinculado: fila !== undefined,
        vinculado_en: fila ? new Date(fila.vinculado_en).toISOString() : null,
      };
    },
  );

  r.delete("/api/yo/telegram", opciones, async (req, reply) => {
    await conUsuario(deps.bd, usuarioDe(req), (tx) =>
      tx.execute(sql`DELETE FROM app.vinculos_telegram WHERE usuario_id = app.usuario_actual()`),
    );
    return reply.code(204).send();
  });

  r.get(
    "/api/yo/notificaciones",
    { ...opciones, schema: { response: { 200: preferenciasRespuesta } } },
    async (req) => conUsuario(deps.bd, usuarioDe(req), (tx) => leerPreferencias(tx)),
  );

  r.put(
    "/api/yo/notificaciones",
    { ...opciones, schema: { body: preferenciaBody, response: { 200: preferenciasRespuesta } } },
    async (req) =>
      conUsuario(deps.bd, usuarioDe(req), async (tx) => {
        if (req.body.nodo_id !== null && !(await nodoVisible(tx, req.body.nodo_id))) {
          throw new NoEncontrado();
        }
        await guardarPreferencia(tx, req.body);
        return leerPreferencias(tx);
      }),
  );

  r.delete(
    "/api/yo/notificaciones/:nodoId",
    { ...opciones, schema: { params: z.object({ nodoId: z.string().uuid() }) } },
    async (req, reply) => {
      await conUsuario(deps.bd, usuarioDe(req), async (tx) => {
        if (!(await nodoVisible(tx, req.params.nodoId))) throw new NoEncontrado();
        await borrarPreferenciaDeNodo(tx, req.params.nodoId);
      });
      return reply.code(204).send();
    },
  );
};
