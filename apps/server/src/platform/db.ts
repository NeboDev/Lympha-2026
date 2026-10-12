import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

/**
 * Acceso a Postgres. Hay exactamente dos formas de consultar:
 *   - `conUsuario()`: la API. Abre una transacción y fija `app.usuario_id` (RLS y vistas `app.v_*` filtran
 *     por ese usuario). Sin usuario no hay consulta.
 *   - `conSistema()`: ingest, worker y notifier (rol `lympha_system`, permisos tabla por tabla).
 * Ninguna otra parte del código toca el pool directamente.
 */

export type Db = NodePgDatabase<Record<string, never>>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

declare const marca: unique symbol;
export type BdApp = BaseDatos & { readonly [marca]: "app" };
export type BdSistema = BaseDatos & { readonly [marca]: "sistema" };

export interface BaseDatos {
  readonly db: Db;
  /** Solo para health checks y cierre ordenado. */
  readonly pool: pg.Pool;
  cerrar(): Promise<void>;
}

export interface OpcionesPool {
  url: string;
  max: number;
  applicationName: string;
}

function crearBase(op: OpcionesPool): BaseDatos {
  const pool = new pg.Pool({
    connectionString: op.url,
    max: op.max,
    application_name: op.applicationName,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // Un error en una conexión ociosa no debe tumbar el proceso.
  pool.on("error", () => undefined);
  return { db: drizzle(pool), pool, cerrar: () => pool.end() };
}

/** Pool de la API (`lympha_app`, sujeto a RLS). Tamaño según el documento de datos: 15. */
export function crearBdApp(url: string, max = 15): BdApp {
  return crearBase({ url, max, applicationName: "lympha-api" }) as BdApp;
}

/** Pool de los procesos internos (`lympha_system`). ingest 5, worker 10, notifier 3. */
export function crearBdSistema(url: string, proceso: string, max: number): BdSistema {
  return crearBase({ url, max, applicationName: `lympha-${proceso}` }) as BdSistema;
}

export interface OpcionesUsuario {
  /** Pepper del hash del código de reclamo; se fija solo por transacción, nunca vive en la base. */
  claimPepper?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ejecuta `fn` en una transacción con `app.usuario_id` fijado para esa transacción. */
export async function conUsuario<T>(
  bd: BdApp,
  usuarioId: string,
  fn: (tx: Tx) => Promise<T>,
  opciones: OpcionesUsuario = {},
): Promise<T> {
  if (!UUID.test(usuarioId)) throw new TypeError("conUsuario: usuarioId debe ser un UUID");
  return bd.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.usuario_id', ${usuarioId}, true)`);
    if (opciones.claimPepper !== undefined) {
      await tx.execute(sql`SELECT set_config('app.claim_pepper', ${opciones.claimPepper}, true)`);
    }
    return fn(tx);
  });
}

/** Ejecuta `fn` en una transacción con el rol de sistema (sin contexto de usuario). */
export async function conSistema<T>(bd: BdSistema, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return bd.db.transaction(fn);
}

export async function pingPostgres(bd: BaseDatos): Promise<boolean> {
  try {
    await bd.pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
