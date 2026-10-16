import { sql } from "drizzle-orm";
import { type BdSistema, conSistema } from "../../platform/db.ts";
import type { EventoNodo } from "./schema.ts";

/** Qué cambió realmente en la conexión del nodo; `null` si el evento no cambió nada (repetido, viejo o atributos). */
export type CambioConexion = "conectado" | "desconectado" | null;

/**
 * Aplica los hechos del nodo en el orden en que llegaron. Son idempotentes: repetir un evento (reentrega del
 * broker, reintento de la cola) deja el mismo resultado.
 *
 *  - `estado`: conectado / desconectado (Last Will incluido). Solo se aplica si es más reciente que el último
 *    cambio registrado, para que un retenido viejo no pise un cambio posterior.
 *  - `atributos`: versión de firmware del nodo.
 *  - `ack`: respuesta del nodo a un comando; solo cambia un comando todavía `enviado` (el segundo ack no pisa).
 *
 * La alarma por desconexión sostenida la abre el barrido de mantenimiento (`modules/alarmas`) cuando el nodo
 * lleva más del tiempo configurado sin conexión; aquí solo queda registrado el cambio y se informa si hubo uno,
 * para que quien llama pueda cerrar la alarma si el nodo volvió.
 */
export async function aplicarEvento(bd: BdSistema, evento: EventoNodo): Promise<CambioConexion> {
  return conSistema(bd, async (tx) => {
    if (evento.tipo === "estado") {
      const r = await tx.execute(sql`
        UPDATE app.estado_nodo
        SET conectado = ${evento.estado === "online"},
            cambio_conexion_en = ${new Date(evento.recibidoEn).toISOString()}::timestamptz,
            actualizado_en = now()
        WHERE nodo_id = ${evento.nodoId} AND espacio_id = ${evento.espacioId}
          AND (cambio_conexion_en IS NULL OR cambio_conexion_en <= ${new Date(evento.recibidoEn).toISOString()}::timestamptz)
          AND (conectado IS DISTINCT FROM ${evento.estado === "online"} OR cambio_conexion_en IS NULL)`);
      if ((r.rowCount ?? 0) === 0) return null;
      return evento.estado === "online" ? "conectado" : "desconectado";
    }
    if (evento.tipo === "ack") {
      await tx.execute(sql`
        UPDATE app.comandos_nodo
        SET estado = ${evento.ok ? "ok" : "error"}, detalle = ${evento.detalle},
            respondido_en = ${new Date(evento.recibidoEn).toISOString()}::timestamptz
        WHERE id = ${evento.comandoId} AND nodo_id = ${evento.nodoId} AND estado = 'enviado'`);
      return null;
    }
    await tx.execute(sql`
      UPDATE app.nodos SET version_fw = ${evento.fw}
      WHERE id = ${evento.nodoId} AND espacio_id = ${evento.espacioId} AND version_fw IS DISTINCT FROM ${evento.fw}`);
    return null;
  });
}
