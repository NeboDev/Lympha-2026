import type pg from "pg";
import type { ClienteDynsec, Comando } from "../../platform/dynsec.ts";
import { PRIORIDAD_REVOCADO } from "../../platform/dynsec.ts";
import {
  formatearCodigoReclamo,
  generarClaveAp,
  generarCodigoReclamo,
  generarPasswordMqtt,
} from "./identidad.ts";

/**
 * Fabricación de lotes (plan de implementación, "Fabricación de un lote", pasos 1 y 2; el grabado en el
 * ESP32 es de H5). Corre con el rol `lympha_owner` y el administrador de Dynamic Security: el CLI de fábrica es
 * una herramienta del operador, nunca un endpoint.
 *
 * Los secretos de cada nodo (contraseña MQTT, clave del AP, código de reclamo) se devuelven UNA vez para
 * grabarlos en el nodo y en su etiqueta. En Postgres solo queda el hash del código y en el broker, la
 * contraseña de su cliente; ni el manifiesto ni los registros los incluyen.
 */

export interface NodoFabricado {
  deviceId: string;
  mqttPassword: string;
  apKey: string;
  /** Con guiones, como se imprime: ABCD-2345-EFGH. */
  codigoReclamo: string;
}

export interface DepsFabrica {
  db: pg.Client;
  dynsec: ClienteDynsec;
  /** Pepper del hash del código de reclamo (el mismo que usa la API). */
  claimPepper: string;
}

export interface OpcionesLote {
  cantidad: number;
  versionHw: string;
  notas?: string | undefined;
  /** Solo desarrollo: deja los nodos ya reclamados por ese espacio (para el simulador). */
  reclamarEn?: string | undefined;
}

export interface LoteFabricado {
  loteId: string;
  creadoEn: string;
  nodos: NodoFabricado[];
}

const POR_PETICION = 50;
export const MAX_POR_LOTE = 1000;

export async function fabricarLote(deps: DepsFabrica, op: OpcionesLote): Promise<LoteFabricado> {
  if (!Number.isInteger(op.cantidad) || op.cantidad < 1 || op.cantidad > MAX_POR_LOTE) {
    throw new RangeError(`cantidad debe estar entre 1 y ${MAX_POR_LOTE}`);
  }
  if (!op.versionHw.trim()) throw new RangeError("versionHw es obligatoria");

  // 1. Identidades: el deviceId lo genera la base (UUIDv7); el resto, este proceso.
  const ids = await deps.db.query<{ id: string }>(
    "SELECT app.uuid_v7() AS id FROM generate_series(1, $1)",
    [op.cantidad],
  );
  const nodos: NodoFabricado[] = ids.rows.map((f) => ({
    deviceId: f.id,
    mqttPassword: generarPasswordMqtt(),
    apKey: generarClaveAp(),
    codigoReclamo: formatearCodigoReclamo(generarCodigoReclamo()),
  }));

  // 2. Postgres: lote + nodos en estado "fabricado" (o ya reclamados en desarrollo). Solo el hash del código.
  let loteId = "";
  let creadoEn = "";
  await deps.db.query("BEGIN");
  try {
    const lote = await deps.db.query<{ id: string; creado_en: Date }>(
      "INSERT INTO app.lotes (cantidad, version_hw, notas) VALUES ($1, $2, $3) RETURNING id, creado_en",
      [op.cantidad, op.versionHw.trim(), op.notas ?? null],
    );
    loteId = lote.rows[0]?.id ?? "";
    creadoEn = new Date(lote.rows[0]?.creado_en ?? Date.now()).toISOString();
    const normalizados = nodos.map((n) => n.codigoReclamo.replaceAll("-", ""));
    await deps.db.query(
      `INSERT INTO app.nodos (id, lote_id, claim_hash, estado, espacio_id, reclamado_en)
       SELECT d, $1, digest(c || $4::text, 'sha256'),
              CASE WHEN $5::uuid IS NULL THEN 'fabricado'::app.estado_nodo_t ELSE 'reclamado'::app.estado_nodo_t END,
              $5::uuid, CASE WHEN $5::uuid IS NULL THEN NULL ELSE now() END
       FROM unnest($2::uuid[], $3::text[]) AS t(d, c)`,
      [loteId, nodos.map((n) => n.deviceId), normalizados, deps.claimPepper, op.reclamarEn ?? null],
    );
    if (op.reclamarEn) {
      await deps.db.query(
        `INSERT INTO app.estado_nodo (nodo_id, espacio_id)
         SELECT unnest($1::uuid[]), $2::uuid ON CONFLICT (nodo_id) DO NOTHING`,
        [nodos.map((n) => n.deviceId), op.reclamarEn],
      );
    }
    await deps.db.query(
      `INSERT INTO app.auditoria (actor_tipo, accion, detalle)
       VALUES ('fabrica', 'lote.fabricado', $1::jsonb)`,
      [JSON.stringify({ lote_id: loteId, cantidad: op.cantidad, version_hw: op.versionHw })],
    );
    await deps.db.query("COMMIT");
  } catch (error) {
    await deps.db.query("ROLLBACK").catch(() => undefined);
    throw error;
  }

  // 3. Dynamic Security: grupo del lote y un cliente por nodo (usuario = client id = deviceId).
  const grupo = `lote:${loteId}`;
  const creados: string[] = [];
  try {
    await deps.dynsec.asegurarGrupo(grupo);
    for (let i = 0; i < nodos.length; i += POR_PETICION) {
      const trozo = nodos.slice(i, i + POR_PETICION);
      const comandos: Comando[] = trozo.map((n) => ({
        command: "createClient",
        username: n.deviceId,
        clientid: n.deviceId,
        password: n.mqttPassword,
        roles: [{ rolename: "nodo" }],
        groups: [{ groupname: grupo }],
      }));
      const respuestas = await deps.dynsec.ejecutar(comandos, 15_000);
      respuestas.forEach((r, j) => {
        const nodo = trozo[j];
        if (nodo && !r.error) creados.push(nodo.deviceId);
      });
      const fallo = respuestas.find((r) => r.error);
      if (fallo || respuestas.length !== trozo.length) {
        throw new Error(
          `Dynamic Security rechazó un alta: ${fallo?.error ?? "respuesta incompleta"}`,
        );
      }
    }
  } catch (error) {
    // Compensación: el lote no llegó a existir del todo, así que no queda a medias en ningún lado.
    await deshacerLote(deps, loteId, creados, grupo).catch(() => undefined);
    throw error;
  }

  return { loteId, creadoEn, nodos };
}

async function deshacerLote(deps: DepsFabrica, loteId: string, clientes: string[], grupo: string) {
  for (const username of clientes) {
    await deps.dynsec
      .comando({ command: "deleteClient", username }, /not found/i)
      .catch(() => undefined);
  }
  await deps.dynsec
    .comando({ command: "deleteGroup", groupname: grupo }, /not found/i)
    .catch(() => undefined);
  await deps.db.query(
    "DELETE FROM app.estado_nodo WHERE nodo_id IN (SELECT id FROM app.nodos WHERE lote_id = $1)",
    [loteId],
  );
  await deps.db.query("DELETE FROM app.nodos WHERE lote_id = $1", [loteId]);
  await deps.db.query("DELETE FROM app.lotes WHERE id = $1", [loteId]);
}

/** Un nodo: el broker lo desconecta y rechaza sus conexiones; en la base queda revocado y sin espacio. */
export async function revocarNodo(deps: DepsFabrica, deviceId: string): Promise<void> {
  await deps.dynsec.comando({ command: "disableClient", username: deviceId }, /not found/i);
  await deps.db.query("BEGIN");
  try {
    const r = await deps.db.query<{ espacio_id: string | null }>(
      "SELECT espacio_id FROM app.nodos WHERE id = $1 FOR UPDATE",
      [deviceId],
    );
    if (r.rowCount === 0) throw new Error("el nodo no existe");
    await deps.db.query(
      "UPDATE app.alarmas SET estado = 'resuelta', resuelta_en = now() WHERE nodo_id = $1 AND estado <> 'resuelta'",
      [deviceId],
    );
    await deps.db.query(
      "UPDATE app.nodos SET estado = 'revocado', espacio_id = NULL WHERE id = $1",
      [deviceId],
    );
    await deps.db.query(
      "UPDATE app.estado_nodo SET espacio_id = NULL, nivel = 'sin_datos', wqi = NULL WHERE nodo_id = $1",
      [deviceId],
    );
    await deps.db.query(
      `INSERT INTO app.auditoria (actor_tipo, espacio_id, nodo_id, accion)
       VALUES ('fabrica', $1, $2, 'nodo.revocado')`,
      [r.rows[0]?.espacio_id ?? null, deviceId],
    );
    await deps.db.query("COMMIT");
  } catch (error) {
    await deps.db.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

/**
 * Un lote entero (RNF-03). Mosquitto evalúa primero los roles del propio cliente y después los de sus grupos, así que
 * el rol `revocado` del grupo NO anula el rol `nodo` de cada cliente (verificado contra Mosquitto 2.1.2). Por eso,
 * además del rol en el grupo, se desactiva cada cliente del lote: el broker lo desconecta y rechaza sus conexiones.
 */
export async function revocarLote(deps: DepsFabrica, loteId: string): Promise<number> {
  const existe = await deps.db.query("SELECT 1 FROM app.lotes WHERE id = $1", [loteId]);
  if (existe.rowCount === 0) throw new Error("el lote no existe");
  await deps.dynsec.comando(
    {
      command: "addGroupRole",
      groupname: `lote:${loteId}`,
      rolename: "revocado",
      priority: PRIORIDAD_REVOCADO,
    },
    /already|internal error/i,
  );
  const ids = (
    await deps.db.query<{ id: string }>("SELECT id FROM app.nodos WHERE lote_id = $1", [loteId])
  ).rows;
  for (let i = 0; i < ids.length; i += POR_PETICION) {
    const respuestas = await deps.dynsec.ejecutar(
      ids.slice(i, i + POR_PETICION).map((f) => ({ command: "disableClient", username: f.id })),
      15_000,
    );
    const fallo = respuestas.find((r) => r.error && !/not found/i.test(r.error));
    if (fallo) throw new Error(`Dynamic Security no pudo desactivar un cliente: ${fallo.error}`);
  }
  await deps.db.query("BEGIN");
  try {
    const lote = await deps.db.query(
      "UPDATE app.lotes SET revocado_en = coalesce(revocado_en, now()) WHERE id = $1",
      [loteId],
    );
    if (lote.rowCount === 0) throw new Error("el lote no existe");
    await deps.db.query(
      "UPDATE app.alarmas SET estado = 'resuelta', resuelta_en = now() WHERE estado <> 'resuelta' AND nodo_id IN (SELECT id FROM app.nodos WHERE lote_id = $1)",
      [loteId],
    );
    const nodos = await deps.db.query(
      "UPDATE app.nodos SET estado = 'revocado', espacio_id = NULL WHERE lote_id = $1 AND estado <> 'revocado'",
      [loteId],
    );
    await deps.db.query(
      "UPDATE app.estado_nodo SET espacio_id = NULL, nivel = 'sin_datos', wqi = NULL WHERE nodo_id IN (SELECT id FROM app.nodos WHERE lote_id = $1)",
      [loteId],
    );
    await deps.db.query(
      `INSERT INTO app.auditoria (actor_tipo, accion, detalle) VALUES ('fabrica', 'lote.revocado', $1::jsonb)`,
      [JSON.stringify({ lote_id: loteId, nodos: nodos.rowCount })],
    );
    await deps.db.query("COMMIT");
    return nodos.rowCount ?? 0;
  } catch (error) {
    await deps.db.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
