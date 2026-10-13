import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { BdApp } from "../../platform/db.ts";
import { NoEncontrado } from "../../platform/errors.ts";
import type { Redis } from "../../platform/valkey.ts";
import { type Autenticador, usuarioDe } from "../identidad/index.ts";
import { crearHubEspacios, type HubEspacios } from "./hub.ts";
import { estadosDelEspacio } from "./repo.ts";

/** Segundos entre comentarios de latido; mantienen viva la conexión ante proxies y balanceadores. */
const LATIDO_MS = 20_000;

/**
 * Stream SSE de un espacio. El usuario se identifica con `Authorization: Bearer` (se usa `fetch` en streaming,
 * no `EventSource`, que no permite cabeceras; es lo que prevé el documento de arquitectura).
 *
 * Primer evento `snapshot` con el estado de todos los nodos; después un `estado` por cada cambio.
 * Un espacio ajeno o inexistente responde 404 igual que cualquier otro recurso (RNF-01).
 */
export interface DepsCalidad {
  bd: BdApp;
  valkey: Redis;
  autenticar: Autenticador;
}

export const rutasCalidad: FastifyPluginAsync<DepsCalidad> = async (app, opciones) => {
  // La conexión de suscripción se abre con el primer cliente (y se duplica del cliente general,
  // que ya trae las credenciales ACL de `api`).
  let hub: HubEspacios | undefined;
  const hubUnico = () => {
    hub ??= crearHubEspacios(() => {
      const suscriptor = opciones.valkey.duplicate();
      suscriptor.on("error", () => undefined); // como en crearValkey: ioredis reconecta solo
      return suscriptor;
    });
    return hub;
  };
  const abiertas = new Set<() => void>();

  // Los streams SSE no terminan solos: hay que cerrarlos ANTES de que Fastify espere a que se
  // vacíen las conexiones (`preClose`), o `app.close()` se queda colgado.
  app.addHook("preClose", async () => {
    for (const cerrar of [...abiertas]) cerrar();
  });
  app.addHook("onClose", async () => {
    await hub?.cerrar();
  });

  app.withTypeProvider<ZodTypeProvider>().get(
    "/api/espacios/:espacioId/eventos",
    {
      preHandler: opciones.autenticar,
      schema: {
        params: z.object({ espacioId: z.string().uuid() }),
      },
    },
    async (req, reply) => {
      const { espacioId } = req.params;

      // Primero la suscripción y después el snapshot: así ningún cambio se cae entre los dos.
      const pendientes: string[] = [];
      let vivo = false;
      let escribir: (texto: string) => void = () => undefined;
      const quitar = await hubUnico().suscribir(espacioId, (mensaje) => {
        if (vivo) escribir(`event: estado\ndata: ${mensaje}\n\n`);
        else pendientes.push(mensaje);
      });

      let nodos: Awaited<ReturnType<typeof estadosDelEspacio>>;
      try {
        nodos = await estadosDelEspacio(opciones.bd, usuarioDe(req), espacioId);
      } catch (error) {
        await quitar();
        throw error;
      }
      if (nodos === null) {
        await quitar();
        throw new NoEncontrado();
      }

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no", // sin búfer en proxies (Caddy lo respeta con flush inmediato)
      });
      escribir = (texto) => {
        if (!raw.writableEnded) raw.write(texto);
      };

      escribir(`retry: 3000\n\nevent: snapshot\ndata: ${JSON.stringify({ nodos })}\n\n`);
      for (const mensaje of pendientes) escribir(`event: estado\ndata: ${mensaje}\n\n`);
      vivo = true;

      const latido = setInterval(() => escribir(": latido\n\n"), LATIDO_MS);
      let terminada = false;
      const terminar = () => {
        if (terminada) return;
        terminada = true;
        clearInterval(latido);
        abiertas.delete(terminar);
        void quitar();
        if (!raw.writableEnded) raw.end();
      };
      abiertas.add(terminar);
      req.raw.on("close", terminar);
    },
  );
};
