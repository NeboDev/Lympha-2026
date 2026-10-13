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
  /**
   * A quién avisar:
   *  - `preferencias`: miembros con Telegram que quieren esta clase de aviso (`niveles` son los niveles
   *    implicados; `null` = alarma que no es de nivel, avisa a todos);
   *  - `ya_avisados`: solo quien ya recibió algo de esta alarma. Es lo que corresponde a un cierre
   *    (resuelta, reconectado): no tiene sentido anunciar que terminó algo de lo que nunca se enteró.
   */
  destinatarios: "preferencias" | "ya_avisados";
  niveles: readonly SeveridadAlarma[] | null;
  payload: PayloadAviso;
  /** Instante de la evaluación; decide si cae en el horario silencioso del usuario. Por defecto, ahora. */
  ahoraMs?: number;
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
  const ahora = new Date(a.ahoraMs ?? Date.now());
  const soloPrevios = a.destinatarios === "ya_avisados";
  const r = await tx.execute(sql`
    INSERT INTO app.notificaciones_salida
      (espacio_id, alarma_id, usuario_id, evento, clave_idempotencia, payload, enviar_despues_de, creado_en)
    SELECT ${a.espacioId}::uuid, ${a.alarmaId}::uuid, m.usuario_id, ${a.evento},
           ${a.alarmaId}::uuid::text || ':' || ${a.evento}::text || ':' || m.usuario_id::text || ':' || ${String(a.clave)}::text,
           ${JSON.stringify(a.payload)}::jsonb,
           app.siguiente_envio(m.usuario_id, ${a.nodoId}::uuid, ${ahora}::timestamptz),
           ${ahora}::timestamptz
    FROM app.membresias m
    JOIN app.vinculos_telegram v ON v.usuario_id = m.usuario_id
    WHERE m.espacio_id = ${a.espacioId}::uuid
      AND CASE WHEN ${soloPrevios}::boolean
            THEN EXISTS (
              SELECT 1 FROM app.notificaciones_salida p
              WHERE p.alarma_id = ${a.alarmaId}::uuid AND p.usuario_id = m.usuario_id AND p.estado <> 'descartada')
            ELSE app.quiere_aviso(m.usuario_id, ${a.nodoId}::uuid, ${niveles}::app.nivel[])
          END
    ON CONFLICT (clave_idempotencia) DO NOTHING`);
  const n = r.rowCount ?? 0;
  // Se entrega al confirmar la transacción: el notifier despierta con la fila ya visible.
  if (n > 0) await tx.execute(sql`SELECT pg_notify(${CANAL_SALIDA}, '')`);
  return n;
}

/** Un aviso para un usuario concreto (recordatorios: cada usuario tiene su propio intervalo). */
export async function encolarAvisoAUsuario(
  tx: Tx,
  a: Omit<AvisoPorEncolar, "destinatarios" | "niveles"> & { usuarioId: string },
): Promise<number> {
  const ahora = new Date(a.ahoraMs ?? Date.now());
  const r = await tx.execute(sql`
    INSERT INTO app.notificaciones_salida
      (espacio_id, alarma_id, usuario_id, evento, clave_idempotencia, payload, enviar_despues_de, creado_en)
    VALUES (${a.espacioId}::uuid, ${a.alarmaId}::uuid, ${a.usuarioId}::uuid, ${a.evento},
            ${a.alarmaId}::uuid::text || ':' || ${a.evento}::text || ':' || ${a.usuarioId}::uuid::text || ':' || ${String(a.clave)}::text,
            ${JSON.stringify(a.payload)}::jsonb,
            app.siguiente_envio(${a.usuarioId}::uuid, ${a.nodoId}::uuid, ${ahora}::timestamptz),
            ${ahora}::timestamptz)
    ON CONFLICT (clave_idempotencia) DO NOTHING`);
  const n = r.rowCount ?? 0;
  if (n > 0) await tx.execute(sql`SELECT pg_notify(${CANAL_SALIDA}, '')`);
  return n;
}
