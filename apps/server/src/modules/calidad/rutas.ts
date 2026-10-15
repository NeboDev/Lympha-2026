import { DIAS_HISTORIAL, nombreEventoEspacio, respuestaHistorial } from "@lympha/contracts";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { BdApp } from "../../platform/db.ts";
import { NoEncontrado } from "../../platform/errors.ts";
import type { Redis } from "../../platform/valkey.ts";
import { type Autenticador, usuarioDe } from "../identidad/index.ts";
import { historialDelNodo } from "./historial.ts";
import { crearHubEspacios, type HubEspacios } from "./hub.ts";
import { estadosDelEspacio } from "./repo.ts";

/** Cabeceras con valor que ya puso un hook (p. ej. CORS), para copiarlas a la respuesta secuestrada. */
function cabecerasFijadas(
  cabeceras: Record<string, string | number | string[] | undefined>,
): Record<string, string | number | string[]> {
  return Object.fromEntries(Object.entries(cabeceras).filter(([, v]) => v !== undefined)) as Record<
    string,
    string | number | string[]
  >;
}

/** Segundos entre comentarios de latido; mantienen viva la conexión ante proxies y balanceadores. */
const LATIDO_MS = 20_000;

/**
 * Stream SSE de un espacio. El usuario se identifica con `Authorization: Bearer` (se usa `fetch` en streaming,
 * no `EventSource`, que no permite cabeceras; es lo que prevé el documento de arquitectura).
 *
 * Primer evento `snapshot` con el estado de todos los nodos; después un `estado` por cada cambio y un `alarma`
 * por cada cambio en el ciclo de vida de una alarma.
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

  // RF-35: nivel predominante por día de los últimos 7 o 30 días (más promedios por parámetro, RF-23).
  app.withTypeProvider<ZodTypeProvider>().get(
    "/api/nodos/:nodoId/historial",
    {
      preHandler: opciones.autenticar,
      schema: {
        params: z.object({ nodoId: z.string().uuid() }),
        querystring: z.object({
          dias: z.coerce
            .number()
            .int()
            .refine((d): d is 7 | 30 => (DIAS_HISTORIAL as readonly number[]).includes(d), "7 o 30")
            .default(7),
        }),
        response: { 200: respuestaHistorial },
      },
    },
    async (req) => {
      const historial = await historialDelNodo(
        opciones.bd,
        usuarioDe(req),
        req.params.nodoId,
        req.query.dias,
      );
      if (historial === null) throw new NoEncontrado();
      return historial;
    },
  );

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
        if (vivo) escribir(`event: ${nombreEventoEspacio(mensaje)}\ndata: ${mensaje}\n\n`);
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
        // lo que ya fijaron los hooks (CORS): al secuestrar la respuesta Fastify no lo copia solo
        ...cabecerasFijadas(reply.getHeaders()),
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no", // sin búfer en proxies (Caddy lo respeta con flush inmediato)
      });
      escribir = (texto) => {
        if (!raw.writableEnded) raw.write(texto);
      };

      escribir(`retry: 3000\n\nevent: snapshot\ndata: ${JSON.stringify({ nodos })}\n\n`);
      for (const mensaje of pendientes) {
        escribir(`event: ${nombreEventoEspacio(mensaje)}\ndata: ${mensaje}\n\n`);
      }
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
