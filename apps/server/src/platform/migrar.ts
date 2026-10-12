import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

/**
 * Ejecutor de migraciones SQL revisables (`apps/server/migrations/NNNN_nombre.sql`).
 * Una transacción por archivo; la primera línea `-- no-transaction` lo ejecuta sin envolverlo
 * (para sentencias que Postgres no admite dentro de una transacción). Corre con `lympha_owner`.
 */

export const DIRECTORIO_MIGRACIONES = join(import.meta.dirname, "..", "..", "migrations");

const CLAVE_BLOQUEO = 7_340_001; // advisory lock: una sola instancia migra a la vez
const ARCHIVO = /^(\d{4})_[a-z0-9_]+\.sql$/;

export interface Migracion {
  nombre: string;
  sql: string;
  sinTransaccion: boolean;
}

export function leerMigraciones(directorio = DIRECTORIO_MIGRACIONES): Migracion[] {
  const archivos = readdirSync(directorio)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const numeros = new Set<string>();
  return archivos.map((nombre) => {
    const m = ARCHIVO.exec(nombre);
    if (!m) throw new Error(`Nombre de migración inválido: ${nombre}`);
    const numero = m[1] as string;
    if (numeros.has(numero)) throw new Error(`Número de migración repetido: ${numero}`);
    numeros.add(numero);
    const sql = readFileSync(join(directorio, nombre), "utf8");
    return { nombre, sql, sinTransaccion: /^\s*--\s*no-transaction\b/.test(sql) };
  });
}

export interface ResultadoMigracion {
  aplicadas: string[];
  yaAplicadas: string[];
}

export async function migrar(
  urlOwner: string,
  alAplicar?: (nombre: string) => void,
  directorio = DIRECTORIO_MIGRACIONES,
): Promise<ResultadoMigracion> {
  const migraciones = leerMigraciones(directorio);
  const cliente = new pg.Client({ connectionString: urlOwner });
  await cliente.connect();
  try {
    await cliente.query("SELECT pg_advisory_lock($1)", [CLAVE_BLOQUEO]);
    await cliente.query(`CREATE TABLE IF NOT EXISTS app.migraciones (
      nombre      text PRIMARY KEY,
      aplicada_en timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await cliente.query<{ nombre: string }>("SELECT nombre FROM app.migraciones");
    const hechas = new Set(rows.map((r) => r.nombre));

    const resultado: ResultadoMigracion = { aplicadas: [], yaAplicadas: [...hechas].sort() };
    for (const m of migraciones) {
      if (hechas.has(m.nombre)) continue;
      try {
        if (m.sinTransaccion) {
          await cliente.query(m.sql);
          await cliente.query("INSERT INTO app.migraciones (nombre) VALUES ($1)", [m.nombre]);
        } else {
          await cliente.query("BEGIN");
          await cliente.query(m.sql);
          await cliente.query("INSERT INTO app.migraciones (nombre) VALUES ($1)", [m.nombre]);
          await cliente.query("COMMIT");
        }
      } catch (error) {
        if (!m.sinTransaccion) await cliente.query("ROLLBACK").catch(() => undefined);
        throw new Error(`Migración ${m.nombre} falló: ${(error as Error).message}`, {
          cause: error,
        });
      }
      resultado.aplicadas.push(m.nombre);
      alAplicar?.(m.nombre);
    }
    return resultado;
  } finally {
    await cliente.query("SELECT pg_advisory_unlock($1)", [CLAVE_BLOQUEO]).catch(() => undefined);
    await cliente.end();
  }
}
