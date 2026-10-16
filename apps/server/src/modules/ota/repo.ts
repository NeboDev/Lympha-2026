import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";
import type { NodoOta } from "./despliegue.ts";

export interface VersionFirmware {
  version: string;
  sha256: string;
  tamanoBytes: number;
  archivo: string;
}

const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/;

/**
 * Copia el binario a `dirOta` como `lympha-<version>.bin` y registra su hash. Repetir el registro con el mismo
 * contenido no cambia nada; con otro contenido para la misma versión falla (una versión publicada no se pisa).
 */
export async function registrarVersion(
  db: pg.Client,
  dirOta: string,
  archivoOrigen: string,
  version: string,
): Promise<VersionFirmware> {
  if (!VERSION.test(version)) throw new Error(`versión inválida: ${version}`);
  const bytes = readFileSync(archivoOrigen);
  if (bytes.length === 0) throw new Error("el binario está vacío");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const archivo = `lympha-${version}.bin`;

  const previa = await db.query<{ sha256: string }>(
    "SELECT sha256 FROM app.versiones_firmware WHERE version = $1",
    [version],
  );
  if (previa.rows[0] && previa.rows[0].sha256 !== sha256) {
    throw new Error(`la versión ${version} ya está registrada con otro contenido`);
  }
  mkdirSync(dirOta, { recursive: true });
  copyFileSync(archivoOrigen, join(dirOta, archivo));
  await db.query(
    `INSERT INTO app.versiones_firmware (version, sha256, tamano_bytes, archivo)
     VALUES ($1, $2, $3, $4) ON CONFLICT (version) DO NOTHING`,
    [version, sha256, bytes.length, archivo],
  );
  return { version, sha256, tamanoBytes: bytes.length, archivo };
}

export async function obtenerVersion(
  db: pg.Client,
  version: string,
): Promise<VersionFirmware | null> {
  const r = await db.query<{
    version: string;
    sha256: string;
    tamano_bytes: number;
    archivo: string;
  }>(
    "SELECT version, sha256, tamano_bytes, archivo FROM app.versiones_firmware WHERE version = $1",
    [version],
  );
  const f = r.rows[0];
  return f
    ? { version: f.version, sha256: f.sha256, tamanoBytes: f.tamano_bytes, archivo: f.archivo }
    : null;
}

/** Nodos en línea, con espacio, que no tienen ya `version`, ordenados por `deviceId`. */
export async function nodosElegibles(db: pg.Client, version: string): Promise<string[]> {
  const r = await db.query<{ id: string }>(
    `SELECT n.id FROM app.nodos n JOIN app.estado_nodo e ON e.nodo_id = n.id
      WHERE n.estado IN ('reclamado', 'activo') AND n.espacio_id IS NOT NULL
        AND e.conectado AND n.version_fw IS DISTINCT FROM $1
      ORDER BY n.id`,
    [version],
  );
  return r.rows.map((f) => f.id);
}

export async function crearDespliegue(
  db: pg.Client,
  version: string,
  etapa: number,
): Promise<string> {
  try {
    const r = await db.query<{ id: string }>(
      "INSERT INTO app.despliegues_ota (version, etapa) VALUES ($1, $2) RETURNING id",
      [version, etapa],
    );
    return (r.rows[0] as { id: string }).id;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new Error("ya hay un despliegue en curso (pnpm ota estado / pnpm ota abortar)");
    }
    throw error;
  }
}

export async function cambiarEtapa(db: pg.Client, id: string, etapa: number): Promise<void> {
  await db.query(
    "UPDATE app.despliegues_ota SET etapa = $2, actualizado_en = now() WHERE id = $1",
    [id, etapa],
  );
}

export async function cerrarDespliegue(
  db: pg.Client,
  id: string,
  estado: "completado" | "detenido",
  motivo?: string,
): Promise<void> {
  await db.query(
    `UPDATE app.despliegues_ota SET estado = $2, motivo = $3, actualizado_en = now()
      WHERE id = $1 AND estado = 'en_curso'`,
    [id, estado, motivo?.slice(0, 280) ?? null],
  );
}

export async function despliegueDetenido(db: pg.Client, id: string): Promise<boolean> {
  const r = await db.query<{ estado: string }>(
    "SELECT estado FROM app.despliegues_ota WHERE id = $1",
    [id],
  );
  return r.rows[0]?.estado === "detenido";
}

/** Detiene el despliegue en curso, si lo hay; devuelve su id. */
export async function abortarDespliegue(db: pg.Client, motivo: string): Promise<string | null> {
  const r = await db.query<{ id: string }>(
    `UPDATE app.despliegues_ota SET estado = 'detenido', motivo = $1, actualizado_en = now()
      WHERE estado = 'en_curso' RETURNING id`,
    [motivo],
  );
  return r.rows[0]?.id ?? null;
}

export async function registrarComando(
  db: pg.Client,
  c: {
    id: string;
    nodoId: string;
    despliegueId: string | null;
    op: "reboot" | "ota";
    version?: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO app.comandos_nodo (id, nodo_id, despliegue_id, op, version)
     VALUES ($1, $2, $3, $4, $5)`,
    [c.id, c.nodoId, c.despliegueId, c.op, c.version ?? null],
  );
}

/** Estado de cada nodo de la cohorte frente a su comando de este despliegue. */
export async function estadosDeNodos(
  db: pg.Client,
  despliegueId: string,
  nodoIds: string[],
): Promise<NodoOta[]> {
  const r = await db.query<{
    id: string;
    version_fw: string | null;
    conectado: boolean | null;
    ultima_lectura_en: Date | null;
    estado: "enviado" | "ok" | "error" | null;
    detalle: string | null;
    enviado_en: Date | null;
    respondido_en: Date | null;
  }>(
    `SELECT n.id, n.version_fw, e.conectado, e.ultima_lectura_en,
            c.estado, c.detalle, c.enviado_en, c.respondido_en
       FROM app.nodos n
       LEFT JOIN app.estado_nodo e ON e.nodo_id = n.id
       LEFT JOIN LATERAL (
         SELECT estado, detalle, enviado_en, respondido_en FROM app.comandos_nodo
          WHERE despliegue_id = $1 AND nodo_id = n.id ORDER BY enviado_en DESC LIMIT 1
       ) c ON true
      WHERE n.id = ANY($2::uuid[])`,
    [despliegueId, nodoIds],
  );
  return r.rows.map((f) => ({
    nodoId: f.id,
    versionFw: f.version_fw,
    conectado: f.conectado ?? false,
    ultimaLecturaEn: f.ultima_lectura_en,
    comando:
      f.estado && f.enviado_en
        ? {
            estado: f.estado,
            detalle: f.detalle,
            enviadoEn: f.enviado_en,
            respondidoEn: f.respondido_en,
          }
        : null,
  }));
}

export interface ResumenOta {
  versiones: { version: string; sha256: string; nodos: number }[];
  despliegue: {
    id: string;
    version: string;
    etapa: number;
    estado: string;
    motivo: string | null;
  } | null;
}

export async function resumen(db: pg.Client): Promise<ResumenOta> {
  const v = await db.query<{ version: string; sha256: string; nodos: string }>(
    `SELECT f.version, f.sha256, count(n.id) AS nodos
       FROM app.versiones_firmware f LEFT JOIN app.nodos n ON n.version_fw = f.version
      GROUP BY f.version, f.sha256, f.creada_en ORDER BY f.creada_en DESC`,
  );
  const d = await db.query<{
    id: string;
    version: string;
    etapa: number;
    estado: string;
    motivo: string | null;
  }>(
    "SELECT id, version, etapa, estado, motivo FROM app.despliegues_ota ORDER BY iniciado_en DESC LIMIT 1",
  );
  return {
    versiones: v.rows.map((f) => ({ ...f, nodos: Number(f.nodos) })),
    despliegue: d.rows[0] ?? null,
  };
}
