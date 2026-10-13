import { canalEspacio } from "@lympha/contracts";
import type { Redis } from "../../platform/valkey.ts";

/**
 * Reparte los mensajes del canal `espacio:{id}` de Valkey a las conexiones SSE de ese espacio.
 * Una sola conexión de suscripción por proceso `api`; se suscribe al canal cuando llega el primer
 * cliente del espacio y se da de baja cuando se va el último.
 */

export type Entrega = (mensaje: string) => void;

export interface HubEspacios {
  /** Registra una entrega para el espacio; devuelve la función que la quita. */
  suscribir(espacioId: string, entrega: Entrega): Promise<() => Promise<void>>;
  cerrar(): Promise<void>;
}

export function crearHubEspacios(crearSuscriptor: () => Redis): HubEspacios {
  const porEspacio = new Map<string, Set<Entrega>>();
  let suscriptor: Redis | undefined;

  function conectar(): Redis {
    if (suscriptor) return suscriptor;
    const s = crearSuscriptor();
    s.on("message", (canal: string, mensaje: string) => {
      const prefijo = canalEspacio("");
      if (!canal.startsWith(prefijo)) return;
      const entregas = porEspacio.get(canal.slice(prefijo.length));
      if (entregas) for (const entregar of entregas) entregar(mensaje);
    });
    suscriptor = s;
    return s;
  }

  return {
    async suscribir(espacioId, entrega) {
      const s = conectar();
      let entregas = porEspacio.get(espacioId);
      if (!entregas) {
        entregas = new Set();
        porEspacio.set(espacioId, entregas);
        await s.subscribe(canalEspacio(espacioId));
      }
      entregas.add(entrega);
      return async () => {
        const actuales = porEspacio.get(espacioId);
        if (!actuales) return;
        actuales.delete(entrega);
        if (actuales.size === 0) {
          porEspacio.delete(espacioId);
          await s.unsubscribe(canalEspacio(espacioId)).catch(() => undefined);
        }
      };
    },

    async cerrar() {
      porEspacio.clear();
      suscriptor?.disconnect();
      suscriptor = undefined;
    },
  };
}
