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
  /** Intentos contando este (se incrementa al reclamar). */
  intentos: number;
  /** Chat de Telegram del usuario ahora mismo; `null` si ya no tiene vínculo. `bigint` llega como texto. */
  chat_id: string | null;
  /** Cuándo debía salir según el horario silencioso (antes de que el reclamo la mueva). */
  programada: Date;
};

/** Mientras un notifier envía una fila, nadie más la reclama este tiempo; si muere, la fila reaparece sola. */
export const ARRENDAMIENTO_S = 60;

/**
 * Reclama hasta `limite` avisos pendientes y vencidos y los arrienda por `arrendamientoS`:
 * `FOR UPDATE SKIP LOCKED` permite varias instancias de notifier sin enviar dos veces, y el arrendamiento
 * (`enviar_despues_de = now() + lease`) hace que, si el proceso muere a mitad de un envío, la fila vuelva a
 * estar disponible sin que nadie la deje trabada. No se mantiene una transacción abierta durante el HTTP.
 * El contador de intentos sube al reclamar.
 */
export async function reclamarPendientes(
  tx: Tx,
  limite = 50,
  arrendamientoS = ARRENDAMIENTO_S,
): Promise<FilaSalida[]> {
  const r = await tx.execute<FilaSalida>(sql`
    UPDATE app.notificaciones_salida s
    SET    intentos = s.intentos + 1,
           enviar_despues_de = now() + make_interval(secs => ${arrendamientoS})
    FROM (
      SELECT id, enviar_despues_de AS programada FROM app.notificaciones_salida
      WHERE  estado = 'pendiente' AND enviar_despues_de <= now()
      ORDER  BY enviar_despues_de
      LIMIT  ${limite}
      FOR UPDATE SKIP LOCKED
    ) c
    WHERE  s.id = c.id
    RETURNING s.id, s.espacio_id, s.alarma_id, s.usuario_id, s.canal, s.evento,
              s.clave_idempotencia, s.payload, s.intentos, c.programada,
              (SELECT v.chat_id::text FROM app.vinculos_telegram v WHERE v.usuario_id = s.usuario_id) AS chat_id`);
  return r.rows;
}

/** Cada cambio de estado de una fila exige que siga `pendiente`: dos notifiers no se pisan. */
export async function marcarEnviada(bd: BdSistema, id: string): Promise<boolean> {
  const r = await conSistema(bd, (tx) =>
    tx.execute(sql`
      UPDATE app.notificaciones_salida
      SET estado = 'enviada', enviada_en = now(), error = NULL
      WHERE id = ${id}::uuid AND estado = 'pendiente'`),
  );
  return (r.rowCount ?? 0) > 0;
}

/** Deja la fila pendiente para dentro de `esperaS` segundos (reintento con espera creciente). */
export async function reprogramar(
  bd: BdSistema,
  id: string,
  esperaS: number,
  error: string,
): Promise<void> {
  await conSistema(bd, (tx) =>
    tx.execute(sql`
      UPDATE app.notificaciones_salida
      SET enviar_despues_de = now() + make_interval(secs => ${esperaS}), error = ${error}
      WHERE id = ${id}::uuid AND estado = 'pendiente'`),
  );
}

/** `fallida` (se agotaron los intentos o el error no tiene remedio) o `descartada` (el usuario ya no recibe avisos). */
export async function cerrarSinEnviar(
  bd: BdSistema,
  id: string,
  estado: "fallida" | "descartada",
  error: string,
): Promise<void> {
  await conSistema(bd, (tx) =>
    tx.execute(sql`
      UPDATE app.notificaciones_salida
      SET estado = ${estado}, error = ${error}
      WHERE id = ${id}::uuid AND estado = 'pendiente'`),
  );
}

/** El usuario bloqueó el bot o borró el chat: se elimina el vínculo y sus avisos pendientes se descartan. */
export async function olvidarVinculo(bd: BdSistema, usuarioId: string): Promise<void> {
  await conSistema(bd, async (tx) => {
    await tx.execute(sql`DELETE FROM app.vinculos_telegram WHERE usuario_id = ${usuarioId}::uuid`);
    await tx.execute(sql`
      UPDATE app.notificaciones_salida
      SET estado = 'descartada', error = 'sin_vinculo'
      WHERE usuario_id = ${usuarioId}::uuid AND estado = 'pendiente' AND canal = 'telegram'`);
  });
}

/** Lecturas para las métricas del notifier. */
export async function contarAlarmasAbiertas(bd: BdSistema): Promise<Record<string, number>> {
  const r = await conSistema(bd, (tx) =>
    tx.execute<{ tipo: string; n: string }>(sql`
      SELECT tipo::text AS tipo, count(*)::text AS n FROM app.alarmas
      WHERE estado <> 'resuelta' GROUP BY tipo`),
  );
  const salida: Record<string, number> = { nivel: 0, sin_conexion: 0, sensor: 0 };
  for (const f of r.rows) salida[f.tipo] = Number(f.n);
  return salida;
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
