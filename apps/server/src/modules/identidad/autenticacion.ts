import type { FastifyRequest } from "fastify";
import { asegurarUsuario, type BdApp } from "../../platform/db.ts";
import { NoAutenticado } from "../../platform/errors.ts";
import type { VerificadorToken } from "./verificador.ts";

declare module "fastify" {
  interface FastifyRequest {
    /** Id del usuario local (`app.usuarios.id`) tras autenticar; fíjalo con `conUsuario()`. */
    usuarioId?: string;
  }
}

/** Hook `preHandler` que exige un Bearer de Firebase válido y deja `req.usuarioId`. */
export interface Autenticador {
  (req: FastifyRequest): Promise<void>;
  /** Olvida la identidad en caché de un usuario (p. ej. tras eliminar su cuenta). */
  olvidar(usuarioId: string): void;
}

const TTL_MS = 60_000;
const MAX_ENTRADAS = 5_000;

export function crearAutenticador(verificador: VerificadorToken, bd: BdApp): Autenticador {
  // uid+correo -> usuario_id, por unos segundos: evita una ida a la base por cada petición.
  const cache = new Map<string, { id: string; hasta: number }>();

  const autenticar: Autenticador = Object.assign(
    async (req: FastifyRequest) => {
      const encabezado = req.headers.authorization;
      const token = encabezado?.startsWith("Bearer ") ? encabezado.slice(7).trim() : "";
      if (!token) throw new NoAutenticado();

      let identidad: Awaited<ReturnType<VerificadorToken["verificar"]>>;
      try {
        identidad = await verificador.verificar(token);
      } catch {
        // Nunca se explica por qué falló: no ayuda a quien prueba tokens.
        throw new NoAutenticado();
      }

      const clave = `${identidad.authUid}\n${identidad.email}`;
      const ahora = Date.now();
      const guardado = cache.get(clave);
      if (guardado && guardado.hasta > ahora) {
        req.usuarioId = guardado.id;
        return;
      }
      const id = await asegurarUsuario(bd, identidad);
      if (cache.size >= MAX_ENTRADAS) cache.clear();
      cache.set(clave, { id, hasta: ahora + TTL_MS });
      req.usuarioId = id;
    },
    {
      olvidar(usuarioId: string) {
        for (const [clave, v] of cache) if (v.id === usuarioId) cache.delete(clave);
      },
    },
  );
  return autenticar;
}

/** El id del usuario autenticado; falla si la ruta olvidó el autenticador. */
export function usuarioDe(req: FastifyRequest): string {
  if (!req.usuarioId) throw new NoAutenticado();
  return req.usuarioId;
}
