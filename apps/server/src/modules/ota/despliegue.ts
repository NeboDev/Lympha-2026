/** Etapas del despliegue gradual (RF-16): porcentaje acumulado de la flota elegible. */
export const ETAPAS = [5, 25, 100] as const;

/** Tiempo que se le da a un nodo para actualizarse y volver: el firmware tiene 5 min para confirmarse. */
export const VENTANA_NODO_MS = 10 * 60_000;

export interface ComandoOta {
  estado: "enviado" | "ok" | "error";
  detalle: string | null;
  enviadoEn: Date;
  respondidoEn: Date | null;
}

export interface NodoOta {
  nodoId: string;
  versionFw: string | null;
  conectado: boolean;
  ultimaLecturaEn: Date | null;
  comando: ComandoOta | null;
}

/**
 * Los primeros `porcentaje` % de los nodos elegibles, al menos uno. El orden es el de `deviceId` (reproducible)
 * y la cohorte es acumulada: la de 25 % contiene a la de 5 %.
 */
export function cohorte(elegibles: readonly string[], porcentaje: number): string[] {
  if (elegibles.length === 0) return [];
  const orden = [...elegibles].sort();
  const n = Math.max(1, Math.ceil((orden.length * porcentaje) / 100));
  return orden.slice(0, n);
}

export type Veredicto =
  | { tipo: "completa" }
  | { tipo: "esperando"; pendientes: number }
  | { tipo: "falla"; motivo: string };

/** Un nodo actualizado y sano: aceptó el comando, volvió con la versión nueva, está en línea y publicó después. */
export function nodoSano(n: NodoOta, version: string): boolean {
  const c = n.comando;
  return Boolean(
    c &&
      c.estado === "ok" &&
      c.respondidoEn &&
      n.conectado &&
      n.versionFw === version &&
      n.ultimaLecturaEn &&
      n.ultimaLecturaEn.getTime() > c.respondidoEn.getTime(),
  );
}

/**
 * Decide si la etapa terminó bien, sigue esperando o falló. Falla si un nodo rechazó el comando o si alguno
 * no volvió sano dentro de la ventana. Avanzar a la siguiente etapa solo ocurre con `completa`.
 */
export function evaluarEtapa(
  nodos: readonly NodoOta[],
  version: string,
  ahora: Date,
  ventanaMs = VENTANA_NODO_MS,
): Veredicto {
  let pendientes = 0;
  for (const n of nodos) {
    if (n.comando?.estado === "error") {
      return {
        tipo: "falla",
        motivo: `el nodo ${n.nodoId} rechazó la actualización${n.comando.detalle ? `: ${n.comando.detalle}` : ""}`,
      };
    }
  }
  for (const n of nodos) {
    if (nodoSano(n, version)) continue;
    pendientes++;
    const enviadoEn = n.comando?.enviadoEn;
    if (enviadoEn && ahora.getTime() - enviadoEn.getTime() > ventanaMs) {
      return {
        tipo: "falla",
        motivo: `el nodo ${n.nodoId} no volvió con la versión ${version} en ${Math.round(ventanaMs / 60_000)} min`,
      };
    }
  }
  return pendientes === 0 ? { tipo: "completa" } : { tipo: "esperando", pendientes };
}
