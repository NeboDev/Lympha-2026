import { sql } from "drizzle-orm";
import { type BdSistema, conSistema } from "../../platform/db.ts";
import type { EventoNodo } from "./schema.ts";

/**
 * Aplica los hechos del nodo en el orden en que llegaron. Son idempotentes: repetir un evento (reentrega del
 * broker, reintento de la cola) deja el mismo resultado.
 *
 *  - `estado`: conectado / desconectado (Last Will incluido). Solo se aplica si es más reciente que el último
 *    cambio registrado, para que un retenido viejo no pise un cambio posterior.
 *  - `atributos`: versión de firmware del nodo.
 *
 * La alarma por desconexión sostenida es de H3: aquí solo queda registrado el cambio.
 */
export async function aplicarEvento(bd: BdSistema, evento: EventoNodo): Promise<void> {
  await conSistema(bd, async (tx) => {
    if (evento.tipo === "estado") {
      await tx.execute(sql`
        UPDATE app.estado_nodo
        SET conectado = ${evento.estado === "online"},
            cambio_conexion_en = ${new Date(evento.recibidoEn).toISOString()}::timestamptz,
            actualizado_en = now()
        WHERE nodo_id = ${evento.nodoId} AND espacio_id = ${evento.espacioId}
          AND (cambio_conexion_en IS NULL OR cambio_conexion_en <= ${new Date(evento.recibidoEn).toISOString()}::timestamptz)
          AND (conectado IS DISTINCT FROM ${evento.estado === "online"} OR cambio_conexion_en IS NULL)`);
      return;
    }
    await tx.execute(sql`
      UPDATE app.nodos SET version_fw = ${evento.fw}
      WHERE id = ${evento.nodoId} AND espacio_id = ${evento.espacioId} AND version_fw IS DISTINCT FROM ${evento.fw}`);
  });
}
