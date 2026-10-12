import { sql } from "drizzle-orm";
import pg from "pg";
import { type BdSistema, conSistema, type Tx } from "../../platform/db.ts";

/** Canal de LISTEN/NOTIFY con el que el worker despierta al notifier al confirmar una alarma. */
export const CANAL_SALIDA = "lympha_salida";

export type FilaSalida = {
  id: string;
  espacio_id: string;
  alarma_id: string | null;
  usuario_id: string;
  canal: string;
  evento: string;
  clave_idempotencia: string;
  payload: unknown;
  intentos: number;
};

/**
 * Reclama hasta `limite` avisos pendientes y vencidos. `FOR UPDATE SKIP LOCKED` permite varias
 * instancias de notifier sin enviar dos veces; el contador de intentos sube al reclamar.
 */
export async function reclamarPendientes(tx: Tx, limite = 50): Promise<FilaSalida[]> {
  const r = await tx.execute<FilaSalida>(sql`
    UPDATE app.notificaciones_salida s
    SET    intentos = intentos + 1
    WHERE  s.id IN (
      SELECT id FROM app.notificaciones_salida
      WHERE  estado = 'pendiente' AND enviar_despues_de <= now()
      ORDER  BY enviar_despues_de
      LIMIT  ${limite}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING s.id, s.espacio_id, s.alarma_id, s.usuario_id, s.canal, s.evento,
              s.clave_idempotencia, s.payload, s.intentos`);
  return r.rows;
}

export async function contarPendientes(bd: BdSistema): Promise<number> {
  const r = await conSistema(bd, (tx) =>
    tx.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM app.notificaciones_salida WHERE estado = 'pendiente'`,
    ),
  );
  return Number(r.rows[0]?.n ?? 0);
}

export interface Escucha {
  cerrar(): Promise<void>;
}

/**
 * LISTEN lympha_salida sobre una conexión dedicada (LISTEN necesita una sesión propia, no el pool).
 * Reconecta sola; el notifier además consulta la tabla cada NOTIFIER_POLL_MS, así que perder una
 * notificación solo retrasa el aviso unos segundos.
 */
export async function escucharSalida(
  url: string,
  alNotificar: () => void,
  alFallar: (error: Error) => void,
): Promise<Escucha> {
  let cliente: pg.Client | null = null;
  let activo = true;
  let temporizador: NodeJS.Timeout | null = null;

  const conectar = async (): Promise<void> => {
    if (!activo) return;
    const nuevo = new pg.Client({
      connectionString: url,
      application_name: "lympha-notifier-listen",
    });
    nuevo.on("notification", (m) => {
      if (m.channel === CANAL_SALIDA) alNotificar();
    });
    const reintentar = (error: Error) => {
      alFallar(error);
      nuevo.removeAllListeners();
      nuevo.end().catch(() => undefined);
      if (activo) temporizador = setTimeout(() => void conectar(), 2000);
    };
    nuevo.on("error", reintentar);
    nuevo.on("end", () => {
      if (activo && cliente === nuevo) reintentar(new Error("conexión LISTEN cerrada"));
    });
    try {
      await nuevo.connect();
      await nuevo.query(`LISTEN ${CANAL_SALIDA}`);
      cliente = nuevo;
    } catch (error) {
      reintentar(error as Error);
    }
  };

  await conectar();
  return {
    async cerrar() {
      activo = false;
      if (temporizador) clearTimeout(temporizador);
      await cliente?.end().catch(() => undefined);
    },
  };
}
