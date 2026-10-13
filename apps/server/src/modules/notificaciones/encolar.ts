import type { EventoAviso, SeveridadAlarma, TipoAlarma } from "@lympha/contracts";
import { sql } from "drizzle-orm";
import type { Tx } from "../../platform/db.ts";
import { CANAL_SALIDA } from "./outbox.ts";

/** Contenido de la fila de la bandeja: `texto` ya formateado y los datos con que se generó. */
export interface PayloadAviso {
  texto: string;
  tipo: TipoAlarma;
  evento: EventoAviso;
  nodo_id: string;
  severidad: SeveridadAlarma | null;
  anterior: SeveridadAlarma | null;
}

export interface AvisoPorEncolar {
  espacioId: string;
  nodoId: string;
  alarmaId: string;
  evento: EventoAviso;
  /**
   * Distingue dos avisos legítimos del mismo evento sobre la misma alarma (dos escaladas a crítica,
   * recordatorios sucesivos). Un reintento repite el mismo valor y la clave única lo vuelve un no-op.
   */
  clave: string | number;
  /** Niveles implicados en la transición; `null` = alarma que no es de nivel (siempre avisa). */
  niveles: readonly SeveridadAlarma[] | null;
  /** También va a quien ya recibió algo de esta alarma, aunque el nivel no esté en su lista (cierres: resuelta, reconectado). */
  incluirPrevios: boolean;
  payload: PayloadAviso;
}

/**
 * Escribe en la bandeja de salida un aviso por cada miembro del espacio con Telegram vinculado que lo quiera
 * (RF-33), dentro de la transacción de quien llama: la alarma y su aviso se confirman juntos o no existen.
 * Respeta el horario silencioso (`enviar_despues_de`). Idempotente por `clave_idempotencia`.
 * Devuelve cuántas filas nuevas quedaron.
 *
 * Drizzle expande un arreglo de JS en varios parámetros: el arreglo de niveles se pasa como un solo literal.
 */
export async function encolarAvisos(tx: Tx, a: AvisoPorEncolar): Promise<number> {
  const niveles = a.niveles === null ? null : `{${a.niveles.join(",")}}`;
  const r = await tx.execute(sql`
    INSERT INTO app.notificaciones_salida
      (espacio_id, alarma_id, usuario_id, evento, clave_idempotencia, payload, enviar_despues_de)
    SELECT ${a.espacioId}::uuid, ${a.alarmaId}::uuid, m.usuario_id, ${a.evento},
           ${a.alarmaId}::uuid::text || ':' || ${a.evento}::text || ':' || m.usuario_id::text || ':' || ${String(a.clave)}::text,
           ${JSON.stringify(a.payload)}::jsonb,
           app.siguiente_envio(m.usuario_id, ${a.nodoId}::uuid, now())
    FROM app.membresias m
    JOIN app.vinculos_telegram v ON v.usuario_id = m.usuario_id
    WHERE m.espacio_id = ${a.espacioId}::uuid
      AND (
        app.quiere_aviso(m.usuario_id, ${a.nodoId}::uuid, ${niveles}::app.nivel[])
        OR (${a.incluirPrevios}::boolean AND EXISTS (
              SELECT 1 FROM app.notificaciones_salida p
              WHERE p.alarma_id = ${a.alarmaId}::uuid AND p.usuario_id = m.usuario_id AND p.estado <> 'descartada'))
      )
    ON CONFLICT (clave_idempotencia) DO NOTHING`);
  const n = r.rowCount ?? 0;
  // Se entrega al confirmar la transacción: el notifier despierta con la fila ya visible.
  if (n > 0) await tx.execute(sql`SELECT pg_notify(${CANAL_SALIDA}, '')`);
  return n;
}
