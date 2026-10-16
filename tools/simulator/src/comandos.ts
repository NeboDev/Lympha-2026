import { createHash } from "node:crypto";
import type { ComandoV1 } from "@lympha/contracts";

/**
 * Cómo reacciona el nodo simulado a una actualización OTA:
 *  - `exito`: descarga, verifica, responde `ok`, reinicia y vuelve con la versión nueva;
 *  - `rechaza`: responde `ok: false` sin descargar;
 *  - `rollback`: acepta y reinicia, pero la versión nueva no logra conectarse al broker: tras `rollbackS` el
 *    bootloader vuelve a la versión anterior (el nodo regresa con la versión vieja);
 *  - `ignora`: no responde nada (nodo mudo).
 */
export type ComportamientoOta = "exito" | "rechaza" | "rollback" | "ignora";
export const COMPORTAMIENTOS_OTA: readonly ComportamientoOta[] = [
  "exito",
  "rechaza",
  "rollback",
  "ignora",
];

export interface OpcionesOta {
  comportamiento: ComportamientoOta;
  /** Descargar el binario por HTTP y verificar su sha256 (como hace el firmware). */
  descargar: boolean;
  /** Segundos fuera de línea durante el reinicio. */
  reinicioS: number;
  /** Segundos hasta que el bootloader revierte (solo `rollback`). */
  rollbackS: number;
}

export const OTA_POR_DEFECTO: OpcionesOta = {
  comportamiento: "exito",
  descargar: true,
  reinicioS: 3,
  rollbackS: 30,
};

export type ComandoOtaV1 = Extract<ComandoV1, { op: "ota" }>;

export interface ResultadoOta {
  /** `null` = no responde. */
  ack: { ok: boolean; detalle: string } | null;
  /** Qué pasa después de responder. */
  luego: "nada" | "reiniciar_nueva" | "reiniciar_y_revertir";
}

/** Descarga la URL y devuelve el sha256 (hex) de lo recibido. */
export async function descargarSha256(url: string): Promise<string> {
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return createHash("sha256")
    .update(Buffer.from(await r.arrayBuffer()))
    .digest("hex");
}

export async function resolverOta(
  cmd: ComandoOtaV1,
  op: OpcionesOta,
  descarga: (url: string) => Promise<string> = descargarSha256,
): Promise<ResultadoOta> {
  if (op.comportamiento === "ignora") return { ack: null, luego: "nada" };
  if (op.comportamiento === "rechaza") {
    return { ack: { ok: false, detalle: "rechazado por el simulador" }, luego: "nada" };
  }
  if (op.descargar) {
    let sha: string;
    try {
      sha = await descarga(cmd.url);
    } catch (error) {
      return {
        ack: { ok: false, detalle: `descarga fallida: ${(error as Error).message}`.slice(0, 200) },
        luego: "nada",
      };
    }
    if (sha !== cmd.sha256) {
      return { ack: { ok: false, detalle: "sha256 distinto" }, luego: "nada" };
    }
  }
  return {
    ack: { ok: true, detalle: "reiniciando" },
    luego: op.comportamiento === "rollback" ? "reiniciar_y_revertir" : "reiniciar_nueva",
  };
}
