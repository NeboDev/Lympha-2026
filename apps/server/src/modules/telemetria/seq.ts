import type { Redis } from "../../platform/valkey.ts";

/**
 * Sigue el número de secuencia de cada nodo (`nodo:{id}:seq`) para contar lecturas perdidas. Un `seq` menor o
 * igual al anterior es un reinicio del nodo o una reentrega: no cuenta como hueco.
 */
export function crearSeguimientoSeq(valkey: Redis) {
  return async (nodoId: string, seq: number): Promise<number> => {
    const clave = `nodo:${nodoId}:seq`;
    const previo = await valkey.getset(clave, String(seq));
    await valkey.expire(clave, 7 * 24 * 3600);
    if (previo === null) return 0;
    const anterior = Number(previo);
    return seq > anterior + 1 ? seq - anterior - 1 : 0;
  };
}
