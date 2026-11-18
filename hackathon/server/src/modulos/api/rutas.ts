import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { ObjectId } from "mongodb";
import { z } from "zod";
import type { Catalogo } from "../../dominio/catalogo.ts";
import {
  NoAutenticado,
  NoEncontrado,
  ServicioNoDisponible,
  SolicitudInvalida,
} from "../../dominio/errores.ts";
import type { ServicioBitacora } from "../bitacora/index.ts";
import type { ServicioCalibraciones } from "../calibraciones/index.ts";
import { type ServicioComunidades, TIPOS_COMUNIDAD } from "../comunidades/index.ts";
import type { Control } from "../control/index.ts";
import type { ServicioIdentidad, Usuario } from "../identidad/index.ts";
import type { ServicioNodos } from "../nodos/index.ts";
import type { ReporteVista } from "../reportes/index.ts";

/** Todo lo que las rutas de usuario necesitan, ya armado. Las rutas no conocen Mongo, Blynk ni Telegram. */
export type ServiciosApi = {
  identidad: ServicioIdentidad;
  comunidades: ServicioComunidades;
  nodos: ServicioNodos;
  bitacora: ServicioBitacora;
  calibraciones: ServicioCalibraciones;
  /** Control del actuador (pulsos con confirmación). */
  control: Control;
  catalogo: Catalogo;
  reportes: {
    /** Los reportes anteriores del nodo, el más reciente primero. */
    recientes(nodoId: ObjectId, limite: number): Promise<ReporteVista[]>;
    /** El PDF del periodo. Lo mismo que pide Telegram con `/reporte`. */
    generar(
      nodoId: ObjectId,
      desde: Date,
      hasta: Date,
      generadoPor: string,
    ): Promise<{ pdf: Buffer; nombreArchivo: string }>;
  };
  /** `null` si Telegram no está configurado (sin token del bot). */
  telegram: {
    crearEnlace(comunidadId: ObjectId): Promise<{ enlace: string; expira: Date }>;
  } | null;
};

declare module "fastify" {
  interface FastifyRequest {
    /** La persona autenticada; solo existe dentro de las rutas de usuario. */
    usuario?: Usuario;
  }
}

const DIA_MS = 86_400_000;

/**
 * Un id mal formado se trata igual que uno inexistente (404): así no se distingue «no existe» de
 * «no es tuyo» ni de «ni siquiera es un id».
 */
function idDe(texto: string): ObjectId {
  if (!/^[0-9a-f]{24}$/i.test(texto)) throw new NoEncontrado();
  return new ObjectId(texto);
}

function usuarioDe(req: FastifyRequest): Usuario {
  if (!req.usuario) throw new NoAutenticado();
  return req.usuario;
}

const fecha = z
  .string()
  .datetime({ offset: true, message: "fecha ISO 8601, p. ej. 2026-11-19T15:00:00Z" })
  .transform((s) => new Date(s));
const idParam = z.object({ id: z.string().max(40) }).strict();

const cuerpoComunidad = z
  .object({
    nombre: z.string().max(200),
    tipo: z.enum(TIPOS_COMUNIDAD as [string, ...string[]]).default("otro"),
  })
  .strict();

const cuerpoNodo = z
  .object({
    nombre: z.string().max(200),
    token_blynk: z.string().max(200),
    ubicacion: z
      .object({
        texto: z.string().min(1).max(120),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
      })
      .strict()
      .optional(),
    parametros: z.array(z.string().max(40)).max(10).optional(),
  })
  .strict();

const consultaSerie = z
  .object({
    desde: fecha.optional(),
    hasta: fecha.optional(),
    paso: z.coerce.number().int().positive().optional(),
  })
  .strict();

const consultaEventos = z
  .object({
    desde: fecha.optional(),
    hasta: fecha.optional(),
    limite: z.coerce.number().int().positive().optional(),
  })
  .strict();

const idAccion = z.object({ id: z.string().max(40), accionId: z.string().max(40) }).strict();

const cuerpoActuador = z
  .object({
    habilitado: z.boolean(),
    nombre: z.string().max(100),
    pulso_max_s: z.number().int().max(10_000),
    enfriamiento_s: z.number().int().max(1_000_000),
    simulado: z.boolean(),
    auto_detener: z.boolean(),
  })
  .strict();

const cuerpoPulso = z
  .object({ duracion_s: z.number().int().max(10_000), motivo: z.string().max(400).optional() })
  .strict();

const cuerpoBitacora = z.object({ texto: z.string().max(2000) }).strict();

const cuerpoCalibracion = z
  .object({
    parametro: z.string().max(40),
    puntos: z.array(z.object({ valor: z.number(), mv: z.number() }).strict()).max(5),
    temp_c: z.number().optional(),
  })
  .strict();

const cuerpoReporte = z
  .object({
    dias: z.number().int().min(1).max(365).optional(),
    desde: fecha.optional(),
    hasta: fecha.optional(),
  })
  .strict()
  .refine((c) => !(c.dias !== undefined && (c.desde || c.hasta)), {
    message: "usa `dias` o `desde` y `hasta`, no las dos",
  })
  .refine((c) => Boolean(c.desde) === Boolean(c.hasta), {
    message: "`desde` y `hasta` van juntas",
  });

/**
 * Rutas de usuario bajo `/api` (todo menos `/api/salud`). Viven en un plugin con su propio hook de
 * autenticación: así **ninguna** ruta se puede registrar aquí sin exigir el token.
 */
export function registrarRutas(app: FastifyInstance, s: ServiciosApi): void {
  app.register(async (api) => {
    api.addHook("onRequest", async (req) => {
      req.usuario = await s.identidad.autenticar(req.headers.authorization);
    });
    // Nada de lo que devuelve la API se guarda en cachés compartidas ni del navegador (RNF-01).
    api.addHook("onSend", async (_req, reply) => {
      reply.header("Cache-Control", "no-store");
    });
    const r = api.withTypeProvider<ZodTypeProvider>();

    r.get("/api/yo", async (req) => {
      const u = usuarioDe(req);
      return {
        usuario: { id: u.uid, nombre: u.nombre, correo: u.correo, demo: u.demo },
        comunidades: await s.comunidades.deUsuario(u.uid),
      };
    });

    r.post("/api/comunidades", { schema: { body: cuerpoComunidad } }, async (req, reply) => {
      const u = usuarioDe(req);
      const c = await s.comunidades.crear(u.uid, {
        nombre: req.body.nombre,
        tipo: req.body.tipo as never,
      });
      return reply.code(201).send(c);
    });

    r.get("/api/comunidades/:id/nodos", { schema: { params: idParam } }, async (req) => {
      return { nodos: await s.nodos.deComunidad(usuarioDe(req).uid, idDe(req.params.id)) };
    });

    r.post(
      "/api/comunidades/:id/nodos",
      { schema: { params: idParam, body: cuerpoNodo } },
      async (req, reply) => {
        const b = req.body;
        const nodo = await s.nodos.alta(usuarioDe(req).uid, idDe(req.params.id), {
          nombre: b.nombre,
          tokenBlynk: b.token_blynk,
          ubicacion: b.ubicacion,
          parametros: b.parametros,
        });
        return reply.code(201).send(nodo);
      },
    );

    r.post(
      "/api/comunidades/:id/telegram/vinculo",
      { schema: { params: idParam } },
      async (req) => {
        const u = usuarioDe(req);
        const id = idDe(req.params.id);
        await s.comunidades.acceso(u.uid, id, "responsable");
        if (!s.telegram) {
          throw new ServicioNoDisponible(
            "telegram_no_configurado",
            "Telegram no está configurado en este servidor.",
          );
        }
        const { enlace, expira } = await s.telegram.crearEnlace(id);
        return { enlace, expira };
      },
    );

    r.get("/api/nodos/:id", { schema: { params: idParam } }, async (req) => {
      return s.nodos.detalle(usuarioDe(req).uid, idDe(req.params.id));
    });

    r.get(
      "/api/nodos/:id/muestras",
      { schema: { params: idParam, querystring: consultaSerie } },
      async (req) => {
        const q = req.query;
        return s.nodos.serie(usuarioDe(req).uid, idDe(req.params.id), {
          desde: q.desde,
          hasta: q.hasta,
          pasoS: q.paso,
        });
      },
    );

    r.get(
      "/api/nodos/:id/eventos",
      { schema: { params: idParam, querystring: consultaEventos } },
      async (req) => {
        return s.nodos.eventos(usuarioDe(req).uid, idDe(req.params.id), {
          desde: req.query.desde,
          hasta: req.query.hasta,
          limite: req.query.limite,
        });
      },
    );

    r.post(
      "/api/nodos/:id/bitacora",
      { schema: { params: idParam, body: cuerpoBitacora } },
      async (req, reply) => {
        const nota = await s.bitacora.anotar(
          usuarioDe(req).uid,
          idDe(req.params.id),
          req.body.texto,
        );
        return reply.code(201).send(nota);
      },
    );

    r.get("/api/nodos/:id/calibraciones", { schema: { params: idParam } }, async (req) => {
      const lista = await s.calibraciones.listar(usuarioDe(req).uid, idDe(req.params.id));
      return {
        calibraciones: lista.map((c) => ({
          id: c._id.toHexString(),
          ts: c.ts,
          parametro: c.parametro,
          temp_c: c.temp,
          puntos: c.puntos,
          pendiente_mv_por_ph: c.pendiente_mv_por_ph,
          pendiente_pct_nernst: c.pendiente_pct_nernst,
          offset_mv: c.offset_mv,
          diagnostico: c.diagnostico,
        })),
      };
    });

    r.post(
      "/api/nodos/:id/calibraciones",
      { schema: { params: idParam, body: cuerpoCalibracion } },
      async (req, reply) => {
        const b = req.body;
        const c = await s.calibraciones.registrar(usuarioDe(req).uid, idDe(req.params.id), {
          parametro: b.parametro,
          puntos: b.puntos,
          tempC: b.temp_c,
        });
        return reply.code(201).send({
          id: c._id.toHexString(),
          ts: c.ts,
          parametro: c.parametro,
          temp_c: c.temp,
          pendiente_mv_por_ph: c.pendiente_mv_por_ph,
          pendiente_pct_nernst: c.pendiente_pct_nernst,
          offset_mv: c.offset_mv,
          diagnostico: c.diagnostico,
        });
      },
    );

    r.get(
      "/api/nodos/:id/reportes",
      {
        schema: {
          params: idParam,
          querystring: z.object({ limite: z.coerce.number().int().positive().optional() }).strict(),
        },
      },
      async (req) => {
        const { nodo } = await s.nodos.acceso(
          usuarioDe(req).uid,
          idDe(req.params.id),
          "integrante",
        );
        return { reportes: await s.reportes.recientes(nodo._id, req.query.limite ?? 20) };
      },
    );

    r.get("/api/nodos/:id/actuador", { schema: { params: idParam } }, async (req) => {
      return s.control.estado(usuarioDe(req).uid, idDe(req.params.id));
    });

    r.put(
      "/api/nodos/:id/actuador",
      { schema: { params: idParam, body: cuerpoActuador } },
      async (req) => {
        return s.control.configurar(usuarioDe(req).uid, idDe(req.params.id), req.body);
      },
    );

    // Pedir un pulso NO manda nada a Blynk: queda pendiente hasta que una persona responsable lo confirme.
    r.post(
      "/api/nodos/:id/actuador/pulsos",
      { schema: { params: idParam, body: cuerpoPulso } },
      async (req, reply) => {
        const accion = await s.control.solicitar(usuarioDe(req).uid, idDe(req.params.id), {
          duracionS: req.body.duracion_s,
          motivo: req.body.motivo,
        });
        return reply.code(201).send(accion);
      },
    );

    r.post(
      "/api/nodos/:id/actuador/pulsos/:accionId/confirmar",
      { schema: { params: idAccion } },
      async (req) => {
        return s.control.confirmar(
          usuarioDe(req).uid,
          idDe(req.params.id),
          idDe(req.params.accionId),
        );
      },
    );

    r.post(
      "/api/nodos/:id/actuador/pulsos/:accionId/cancelar",
      { schema: { params: idAccion } },
      async (req) => {
        return s.control.cancelar(
          usuarioDe(req).uid,
          idDe(req.params.id),
          idDe(req.params.accionId),
        );
      },
    );

    r.post("/api/nodos/:id/actuador/detener", { schema: { params: idParam } }, async (req) => {
      return { accion: await s.control.detener(usuarioDe(req).uid, idDe(req.params.id)) };
    });

    r.post(
      "/api/nodos/:id/reportes",
      { schema: { params: idParam, body: cuerpoReporte.nullish() } },
      async (req, reply) => {
        const u = usuarioDe(req);
        const { nodo } = await s.nodos.acceso(u.uid, idDe(req.params.id), "integrante");
        const b = req.body ?? {};
        const dias = b.dias ?? s.catalogo.reporte.dias_defecto;
        const hasta = b.hasta ?? new Date();
        const desde = b.desde ?? new Date(hasta.getTime() - dias * DIA_MS);
        if (!(desde < hasta)) {
          throw new SolicitudInvalida(
            "periodo_invalido",
            "El periodo debe empezar antes de terminar.",
          );
        }
        const generadoPor = u.nombre ?? "Integrante de la comunidad";
        const { pdf, nombreArchivo } = await s.reportes.generar(
          nodo._id,
          desde,
          hasta,
          generadoPor,
        );
        return reply
          .header("Content-Type", "application/pdf")
          .header("Content-Disposition", `attachment; filename="${nombreArchivo}"`)
          .send(pdf);
      },
    );
  });
}
