import { parsearTopico, telemetria } from "@lympha/contracts";
import type { Logger } from "../../platform/logger.ts";
import type { ResolvedorNodo } from "../dispositivos/index.ts";
import type { TrabajoLecturas } from "./schema.ts";

/**
 * Códigos de razón MQTT 5 del PUBACK. Una lectura rechazada también se confirma (con código de
 * error) para que el broker no la reentregue en bucle; solo los fallos de infraestructura se
 * reintentan sin confirmar.
 */
export const CODIGO_PUBACK = {
  ok: 0,
  topicoInvalido: 144,
  nodoNoAutorizado: 135,
  payloadInvalido: 153,
} as const;

/** Un reloj del nodo muy adelantado o muy atrasado indica un nodo sin NTP (RNF-25). */
const MAX_ADELANTO_MS = 10 * 60 * 1000;
const MAX_ANTIGUEDAD_MS = 30 * 24 * 3600 * 1000; // la retención de ts.lecturas

export interface DepsIngesta {
  resolver: ResolvedorNodo;
  /** Debe resolver solo cuando el trabajo quedó en la cola; el PUBACK sale después. */
  encolar(trabajo: TrabajoLecturas): Promise<void>;
  log: Logger;
  ahora?: () => number;
}

export interface Ingesta {
  /**
   * Procesa un mensaje de telemetría y devuelve el código del PUBACK. Lanza solo ante fallos de
   * infraestructura (Valkey, Postgres, cola): quien llama reintenta sin confirmar el mensaje.
   */
  manejar(topico: string, carga: Buffer): Promise<number>;
}

export function crearIngesta(deps: DepsIngesta): Ingesta {
  const ahora = deps.ahora ?? Date.now;

  return {
    async manejar(topico, carga) {
      const t = parsearTopico(topico);
      if (!t || t.tipo !== "telemetry") {
        deps.log.warn({ topico }, "tópico no válido");
        return CODIGO_PUBACK.topicoInvalido;
      }

      let json: unknown;
      try {
        json = JSON.parse(carga.toString("utf8"));
      } catch {
        deps.log.warn({ nodoId: t.deviceId }, "lectura rechazada: JSON ilegible");
        return CODIGO_PUBACK.payloadInvalido;
      }
      const parsed = telemetria.safeParse(json);
      if (!parsed.success) {
        deps.log.warn(
          { nodoId: t.deviceId, motivos: parsed.error.issues.map((i) => i.path.join(".")) },
          "lectura rechazada: payload inválido",
        );
        return CODIGO_PUBACK.payloadInvalido;
      }
      const m = parsed.data;

      const tsMs = m.ts * 1000;
      const ahoraMs = ahora();
      if (tsMs > ahoraMs + MAX_ADELANTO_MS || tsMs < ahoraMs - MAX_ANTIGUEDAD_MS) {
        deps.log.warn(
          { nodoId: t.deviceId, ts: m.ts },
          "lectura rechazada: reloj del nodo fuera de rango",
        );
        return CODIGO_PUBACK.payloadInvalido;
      }

      const meta = await deps.resolver.resolver(t.deviceId);
      if (!meta?.espacioId || !["reclamado", "activo"].includes(meta.estado)) {
        deps.log.warn(
          { nodoId: t.deviceId, estado: meta?.estado ?? "desconocido" },
          "lectura rechazada: nodo sin espacio o deshabilitado",
        );
        return CODIGO_PUBACK.nodoNoAutorizado;
      }

      await deps.encolar({
        lecturas: [
          {
            nodoId: t.deviceId,
            espacioId: meta.espacioId,
            ts: tsMs,
            seq: m.seq,
            ph: m.ph ?? null,
            temperatura: m.t ?? null,
            conductividad: m.ec ?? null,
            turbidez: m.turb ?? null,
            tds: m.tds ?? null,
            recibidoEn: ahoraMs,
          },
        ],
      });
      return CODIGO_PUBACK.ok;
    },
  };
}
