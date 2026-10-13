import { canalEspacio, type EventoAlarma } from "@lympha/contracts";
import { Worker } from "bullmq";
import { sql } from "drizzle-orm";
import { type BdSistema, conSistema, type Tx } from "../../platform/db.ts";
import type { Logger } from "../../platform/logger.ts";
import { COLA_MANTENIMIENTO, crearCola } from "../../platform/queues.ts";
import type { Redis } from "../../platform/valkey.ts";
import { encolarAvisoAUsuario, encolarAvisos } from "../notificaciones/index.ts";
import { nombreNodo, textoAviso } from "./plantillas.ts";
import { minutosSinConexion } from "./reglas.ts";

/**
 * Barrido de mantenimiento de las alarmas. Un trabajo repetible de BullMQ (cola `mantenimiento`) lo dispara cada
 * pocos segundos y consulta Postgres, que es la fuente de verdad: no hay temporizadores por nodo que cancelar
 * ni que perder si Valkey se vacía. Cada paso es idempotente y está acotado.
 *
 *  1. Desconexión sostenida (RF-29): un nodo que lleva más del tiempo configurado desconectado abre su alarma
 *     `sin_conexion`. Un nodo recién reclamado que nunca se conectó no alarma.
 *  2. Reconexión: cierra las alarmas `sin_conexion` de nodos que ya están conectados. El camino normal es
 *     inmediato (`resolverSinConexion`, desde el evento `online`); este paso cubre un evento perdido.
 *  3. Recordatorios (RF-30): mientras una alarma siga activa, repite el aviso cada `recordatorio_h` horas de
 *     cada usuario (su preferencia; 6 por defecto). Una alarma atendida deja de recordar.
 */

export interface OpcionesBarrido {
  /** Sustituye el tiempo sin conexión de los perfiles (segundos). Para pruebas y demostraciones locales. */
  sinConexionS?: number | undefined;
}

export interface ResultadoBarrido {
  eventos: EventoAlarma[];
  avisos: number;
}

const RECORDATORIO_H_DEFECTO = 6;
const LIMITE_POR_PASO = 200;

interface Nombres extends Record<string, unknown> {
  nodo: string | null;
  espacio: string;
}

async function nombresDe(tx: Tx, nodoId: string, espacioId: string): Promise<Nombres> {
  const r = await tx.execute<Nombres>(sql`
    SELECT n.nombre AS nodo, es.nombre AS espacio
    FROM app.nodos n, app.espacios es
    WHERE n.id = ${nodoId}::uuid AND es.id = ${espacioId}::uuid`);
  return r.rows[0] ?? { nodo: null, espacio: "tu espacio" };
}

const minutosEntre = (desdeMs: number, hastaMs: number) =>
  Math.max(0, (hastaMs - desdeMs) / 60_000);

// ── 1. Desconexión sostenida ───────────────────────────────────────────────────────────────────────

interface Candidato extends Record<string, unknown> {
  nodo_id: string;
  espacio_id: string;
  cambio_conexion_en: Date;
  nodo_nombre: string | null;
  espacio_nombre: string;
  reglas_alarma: unknown;
}

async function abrirSinConexion(
  bd: BdSistema,
  ahoraMs: number,
  op: OpcionesBarrido,
): Promise<ResultadoBarrido> {
  const eventos: EventoAlarma[] = [];
  let avisos = 0;
  // Ningún perfil espera menos de un minuto; el filtro fino (por perfil) se hace en código.
  const cota = new Date(ahoraMs - (op.sinConexionS ?? 60) * 1000);
  const candidatos = await conSistema(bd, async (tx) => {
    const r = await tx.execute<Candidato>(sql`
      SELECT e.nodo_id, e.espacio_id, e.cambio_conexion_en, n.nombre AS nodo_nombre,
             es.nombre AS espacio_nombre, p.reglas_alarma
      FROM app.estado_nodo e
      JOIN app.nodos n ON n.id = e.nodo_id AND n.espacio_id = e.espacio_id
      JOIN app.espacios es ON es.id = e.espacio_id
      JOIN app.perfiles_uso p ON p.id = n.perfil_id
      WHERE e.conectado = false AND e.espacio_id IS NOT NULL AND e.cambio_conexion_en <= ${cota}
        AND NOT EXISTS (
          SELECT 1 FROM app.alarmas a
          WHERE a.nodo_id = e.nodo_id AND a.tipo = 'sin_conexion' AND a.estado <> 'resuelta')
      ORDER BY e.cambio_conexion_en
      LIMIT ${LIMITE_POR_PASO}`);
    return r.rows;
  });

  for (const c of candidatos) {
    const desdeMs = new Date(c.cambio_conexion_en).getTime();
    const umbralS = op.sinConexionS ?? minutosSinConexion(c.reglas_alarma) * 60;
    if (ahoraMs - desdeMs < umbralS * 1000) continue;

    await conSistema(bd, async (tx) => {
      const nueva = (
        await tx.execute<{ id: string; abierta_en: Date }>(sql`
          INSERT INTO app.alarmas (nodo_id, espacio_id, tipo, severidad, causa, detalle)
          VALUES (${c.nodo_id}::uuid, ${c.espacio_id}::uuid, 'sin_conexion', 'regular', 'Sin conexión',
                  jsonb_build_object('desconectado_desde', ${new Date(desdeMs).toISOString()}::text))
          ON CONFLICT (nodo_id, tipo) WHERE estado <> 'resuelta' DO NOTHING
          RETURNING id, abierta_en`)
      ).rows[0];
      if (!nueva) return;
      const minutos = minutosEntre(desdeMs, ahoraMs);
      avisos += await encolarAvisos(tx, {
        espacioId: c.espacio_id,
        nodoId: c.nodo_id,
        alarmaId: nueva.id,
        evento: "sin_conexion",
        clave: desdeMs,
        destinatarios: "preferencias",
        niveles: null,
        ahoraMs,
        payload: {
          texto: textoAviso({
            evento: "sin_conexion",
            tipo: "sin_conexion",
            nodo: nombreNodo(c.nodo_nombre, c.nodo_id),
            espacio: c.espacio_nombre,
            minutos,
          }),
          tipo: "sin_conexion",
          evento: "sin_conexion",
          nodo_id: c.nodo_id,
          severidad: null,
          anterior: null,
        },
      });
      eventos.push({
        alarma_id: nueva.id,
        nodo_id: c.nodo_id,
        espacio_id: c.espacio_id,
        tipo: "sin_conexion",
        severidad: "regular",
        estado: "activa",
        cambio: "abierta",
        causa: "Sin conexión",
        abierta_en: new Date(nueva.abierta_en).toISOString(),
        actualizado_en: new Date(ahoraMs).toISOString(),
      });
    });
  }
  return { eventos, avisos };
}

// ── 2. Reconexión ───────────────────────────────────────────────────────────────────────────────────

/**
 * Cierra la alarma de desconexión abierta de un nodo y avisa que volvió a quien ya había sido avisado.
 * Devuelve el cambio para el stream del espacio, o `null` si no había alarma abierta.
 */
export async function resolverSinConexion(
  bd: BdSistema,
  nodoId: string,
  ahoraMs: number = Date.now(),
): Promise<{ evento: EventoAlarma; avisos: number } | null> {
  return conSistema(bd, async (tx) => {
    const cerrada = (
      await tx.execute<{ id: string; espacio_id: string; abierta_en: Date }>(sql`
        UPDATE app.alarmas
        SET estado = 'resuelta', resuelta_en = now(),
            detalle = detalle || jsonb_build_object('reconectado_en', ${new Date(ahoraMs).toISOString()}::text)
        WHERE nodo_id = ${nodoId}::uuid AND tipo = 'sin_conexion' AND estado <> 'resuelta'
        RETURNING id, espacio_id, abierta_en`)
    ).rows[0];
    if (!cerrada) return null;
    const n = await nombresDe(tx, nodoId, cerrada.espacio_id);
    const avisos = await encolarAvisos(tx, {
      espacioId: cerrada.espacio_id,
      nodoId,
      alarmaId: cerrada.id,
      evento: "reconectado",
      clave: ahoraMs,
      destinatarios: "ya_avisados",
      niveles: null,
      ahoraMs,
      payload: {
        texto: textoAviso({
          evento: "reconectado",
          tipo: "sin_conexion",
          nodo: nombreNodo(n.nodo, nodoId),
          espacio: n.espacio,
        }),
        tipo: "sin_conexion",
        evento: "reconectado",
        nodo_id: nodoId,
        severidad: null,
        anterior: null,
      },
    });
    return {
      avisos,
      evento: {
        alarma_id: cerrada.id,
        nodo_id: nodoId,
        espacio_id: cerrada.espacio_id,
        tipo: "sin_conexion",
        severidad: "regular",
        estado: "resuelta",
        cambio: "resuelta",
        causa: "Sin conexión",
        abierta_en: new Date(cerrada.abierta_en).toISOString(),
        actualizado_en: new Date(ahoraMs).toISOString(),
      },
    };
  });
}

async function resolverReconectados(bd: BdSistema, ahoraMs: number): Promise<ResultadoBarrido> {
  const nodos = await conSistema(bd, async (tx) => {
    const r = await tx.execute<{ nodo_id: string }>(sql`
      SELECT a.nodo_id
      FROM app.alarmas a JOIN app.estado_nodo e ON e.nodo_id = a.nodo_id
      WHERE a.tipo = 'sin_conexion' AND a.estado <> 'resuelta' AND e.conectado = true
      LIMIT ${LIMITE_POR_PASO}`);
    return r.rows.map((f) => f.nodo_id);
  });
  const eventos: EventoAlarma[] = [];
  let avisos = 0;
  for (const nodoId of nodos) {
    const r = await resolverSinConexion(bd, nodoId, ahoraMs);
    if (r) {
      eventos.push(r.evento);
      avisos += r.avisos;
    }
  }
  return { eventos, avisos };
}

// ── 3. Recordatorios ────────────────────────────────────────────────────────────────────────────────

interface Pendiente extends Record<string, unknown> {
  alarma_id: string;
  nodo_id: string;
  espacio_id: string;
  usuario_id: string;
  tipo: "nivel" | "sin_conexion" | "sensor";
  severidad: "regular" | "mala" | "critica";
  abierta_en: Date;
  causa: string | null;
  accion: string | null;
  ultimo: Date;
  nodo_nombre: string | null;
  espacio_nombre: string;
}

async function recordar(bd: BdSistema, ahoraMs: number): Promise<ResultadoBarrido> {
  const ahora = new Date(ahoraMs);
  const pendientes = await conSistema(bd, async (tx) => {
    // Un usuario recibe un recordatorio si la alarma sigue activa, quiere ese tipo de aviso y han pasado sus
    // horas desde el último aviso de la alarma (o desde que se abrió, si nunca recibió ninguno).
    const r = await tx.execute<Pendiente>(sql`
      SELECT a.id AS alarma_id, a.nodo_id, a.espacio_id, m.usuario_id, a.tipo::text AS tipo,
             a.severidad::text AS severidad, a.abierta_en, a.causa,
             coalesce(a.detalle->'ultimo'->>'accion', a.detalle->'apertura'->>'accion') AS accion,
             coalesce(ult.ultimo, a.abierta_en) AS ultimo, n.nombre AS nodo_nombre, es.nombre AS espacio_nombre
      FROM app.alarmas a
      JOIN app.nodos n ON n.id = a.nodo_id
      JOIN app.espacios es ON es.id = a.espacio_id
      JOIN app.membresias m ON m.espacio_id = a.espacio_id
      JOIN app.vinculos_telegram v ON v.usuario_id = m.usuario_id
      LEFT JOIN LATERAL (
        SELECT p.recordatorio_h FROM app.preferencias_notificacion p
        WHERE p.usuario_id = m.usuario_id AND (p.nodo_id = a.nodo_id OR p.nodo_id IS NULL)
        ORDER BY p.nodo_id IS NULL LIMIT 1) pref ON true
      LEFT JOIN LATERAL (
        SELECT max(s.creado_en) AS ultimo FROM app.notificaciones_salida s
        WHERE s.alarma_id = a.id AND s.usuario_id = m.usuario_id AND s.estado <> 'descartada') ult ON true
      WHERE a.estado = 'activa'
        AND coalesce(ult.ultimo, a.abierta_en)
              <= ${ahora}::timestamptz - make_interval(hours => coalesce(pref.recordatorio_h, ${RECORDATORIO_H_DEFECTO})::int)
        AND app.quiere_aviso(m.usuario_id, a.nodo_id,
              CASE WHEN a.tipo = 'nivel' THEN ARRAY[a.severidad] ELSE NULL END)
      LIMIT ${LIMITE_POR_PASO}`);
    return r.rows;
  });

  let avisos = 0;
  for (const p of pendientes) {
    const ultimoMs = new Date(p.ultimo).getTime();
    avisos += await conSistema(bd, (tx) =>
      encolarAvisoAUsuario(tx, {
        espacioId: p.espacio_id,
        nodoId: p.nodo_id,
        alarmaId: p.alarma_id,
        usuarioId: p.usuario_id,
        evento: "recordatorio",
        // El mismo "último aviso" produce la misma clave: dos barridos seguidos no duplican el recordatorio.
        clave: ultimoMs,
        ahoraMs,
        payload: {
          texto: textoAviso({
            evento: "recordatorio",
            tipo: p.tipo,
            nodo: nombreNodo(p.nodo_nombre, p.nodo_id),
            espacio: p.espacio_nombre,
            severidad: p.tipo === "nivel" ? p.severidad : undefined,
            causa: p.causa,
            accion: p.accion,
            minutos: minutosEntre(new Date(p.abierta_en).getTime(), ahoraMs),
          }),
          tipo: p.tipo,
          evento: "recordatorio",
          nodo_id: p.nodo_id,
          severidad: p.tipo === "nivel" ? p.severidad : null,
          anterior: null,
        },
      }),
    );
  }
  return { eventos: [], avisos };
}

/** Un barrido completo. Cada paso es independiente: si uno falla, el error sube y el siguiente barrido reintenta. */
export async function barrer(
  bd: BdSistema,
  ahoraMs: number = Date.now(),
  op: OpcionesBarrido = {},
): Promise<ResultadoBarrido> {
  const pasos = [
    await abrirSinConexion(bd, ahoraMs, op),
    await resolverReconectados(bd, ahoraMs),
    await recordar(bd, ahoraMs),
  ];
  return {
    eventos: pasos.flatMap((p) => p.eventos),
    avisos: pasos.reduce((suma, p) => suma + p.avisos, 0),
  };
}

// ── Disparo periódico ───────────────────────────────────────────────────────────────────────────────

export interface OpcionesMantenimiento extends OpcionesBarrido {
  conexion: Redis;
  valkey: Redis;
  bd: BdSistema;
  log: Logger;
  /** Cada cuánto corre el barrido. */
  cadaMs: number;
  /** Para métricas. */
  alBarrer?: (r: ResultadoBarrido) => void;
}

export interface Mantenimiento {
  detener(): Promise<void>;
}

/**
 * Registra el barrido como trabajo repetible de BullMQ y lo consume. `upsertJobScheduler` es idempotente:
 * varios workers o reinicios dejan un solo calendario. Concurrencia 1, así dos barridos no se pisan.
 */
export async function iniciarMantenimiento(op: OpcionesMantenimiento): Promise<Mantenimiento> {
  const cola = crearCola<Record<string, never>>(COLA_MANTENIMIENTO, op.conexion);
  await cola.upsertJobScheduler(
    "barrido-alarmas",
    { every: op.cadaMs },
    {
      name: "barrido",
      data: {},
      opts: { attempts: 1, removeOnComplete: true, removeOnFail: { count: 20 } },
    },
  );

  const worker = new Worker<Record<string, never>>(
    COLA_MANTENIMIENTO,
    async () => {
      const r = await barrer(op.bd, Date.now(), { sinConexionS: op.sinConexionS });
      for (const e of r.eventos) {
        await op.valkey
          .publish(canalEspacio(e.espacio_id), JSON.stringify(e))
          .catch((err: unknown) => {
            op.log.warn({ err, alarmaId: e.alarma_id }, "no se pudo publicar la alarma");
          });
      }
      op.alBarrer?.(r);
      return { eventos: r.eventos.length, avisos: r.avisos };
    },
    { connection: op.conexion, concurrency: 1 },
  );
  worker.on("error", (e) => op.log.error({ err: e }, "error de BullMQ (mantenimiento)"));
  worker.on("failed", (_job, e) => op.log.error({ err: e }, "el barrido de alarmas falló"));

  return {
    async detener() {
      await worker.close();
      await cola.close();
    },
  };
}
