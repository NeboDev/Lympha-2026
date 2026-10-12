import type { BdSistema } from "../../platform/db.ts";
import type { Redis } from "../../platform/valkey.ts";
import { buscarMetaNodo, type MetaNodo } from "./repo.ts";

/** Canal pub/sub con el deviceId cuyo `meta` cambió (reclamo, desvinculación, perfil). */
export const CANAL_INVALIDAR_NODO = "invalidar:nodo";

const TTL_META_S = 10 * 60;
/** Un nodo inexistente se recuerda poco: si lo dan de alta, `invalidar:nodo` o el TTL lo corrigen. */
const TTL_AUSENTE_S = 30;

const clave = (nodoId: string) => `nodo:${nodoId}:meta`;

export interface ResolvedorNodo {
  /** Resuelve el nodo desde la caché (Valkey) o, si falta, desde Postgres. `null` si no existe. */
  resolver(nodoId: string): Promise<MetaNodo | null>;
  invalidar(nodoId: string): Promise<void>;
}

export function crearResolvedorNodo(valkey: Redis, bd: BdSistema): ResolvedorNodo {
  return {
    async resolver(nodoId) {
      const cache = await valkey.hgetall(clave(nodoId));
      if (cache.ausente === "1") return null;
      if (cache.perfil_id && cache.estado) {
        return {
          espacioId: cache.espacio_id ? cache.espacio_id : null,
          perfilId: cache.perfil_id,
          perfilVersion: Number(cache.perfil_version),
          estado: cache.estado,
        };
      }

      const meta = await buscarMetaNodo(bd, nodoId);
      const k = clave(nodoId);
      if (!meta) {
        await valkey.multi().hset(k, { ausente: "1" }).expire(k, TTL_AUSENTE_S).exec();
        return null;
      }
      await valkey
        .multi()
        .del(k)
        .hset(k, {
          espacio_id: meta.espacioId ?? "",
          perfil_id: meta.perfilId,
          perfil_version: String(meta.perfilVersion),
          estado: meta.estado,
        })
        .expire(k, TTL_META_S)
        .exec();
      return meta;
    },

    async invalidar(nodoId) {
      await valkey.del(clave(nodoId));
    },
  };
}
