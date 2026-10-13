import { atributosV1, estadoConexion, parsearTopico, telemetria } from "@lympha/contracts";
import type { Logger } from "../../platform/logger.ts";
import type { MetaNodo, ResolvedorNodo } from "../dispositivos/index.ts";
import type { EventoNodo, TrabajoLecturas } from "./schema.ts";

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

export type MotivoRechazo =
  | "topico_invalido"
  | "json_ilegible"
  | "payload_invalido"
  | "reloj_fuera_de_rango"
  | "nodo_no_autorizado";

export interface MetricasIngesta {
  recibida(tipo: "telemetry" | "status" | "attributes"): void;
  rechazada(motivo: MotivoRechazo): void;
  /** Lecturas que faltan según `seq` (un hueco de 3 suma 3). */
  huecos(n: number): void;
}

export interface DepsIngesta {
  resolver: ResolvedorNodo;
  /** Debe resolver solo cuando el trabajo quedó en la cola; el PUBACK sale después. */
  encolar(trabajo: TrabajoLecturas): Promise<void>;
  /** Cambios de conexión y atributos del nodo; misma garantía que `encolar`. */
  encolarEvento(evento: EventoNodo): Promise<void>;
  log: Logger;
  ahora?: () => number;
  metricas?: MetricasIngesta;
  /** Registra `seq` y devuelve cuántas lecturas se perdieron desde la anterior (0 si es la primera o reinició). */
  seguirSeq?: (nodoId: string, seq: number) => Promise<number>;
}

export interface Ingesta {
  /**
   * Procesa un mensaje de un nodo y devuelve el código del PUBACK. Lanza solo ante fallos de
   * infraestructura (Valkey, Postgres, cola): quien llama reintenta sin confirmar el mensaje.
   */
  manejar(topico: string, carga: Buffer): Promise<number>;
}

export function crearIngesta(deps: DepsIngesta): Ingesta {
  const ahora = deps.ahora ?? Date.now;
  const m = deps.metricas;

  function rechazar(motivo: MotivoRechazo, codigo: number): number {
    m?.rechazada(motivo);
    return codigo;
  }

  /** Nodo autorizado a publicar: reclamado o activo y con espacio. */
  async function nodoAutorizado(
    nodoId: string,
  ): Promise<(MetaNodo & { espacioId: string }) | null> {
    const meta = await deps.resolver.resolver(nodoId);
    if (!meta?.espacioId || !["reclamado", "activo"].includes(meta.estado)) {
      deps.log.warn(
        { nodoId, estado: meta?.estado ?? "desconocido" },
        "mensaje rechazado: nodo sin espacio o deshabilitado",
      );
      return null;
    }
    return { ...meta, espacioId: meta.espacioId };
  }

  async function telemetriaDe(nodoId: string, carga: Buffer): Promise<number> {
    let json: unknown;
    try {
      json = JSON.parse(carga.toString("utf8"));
    } catch {
      deps.log.warn({ nodoId }, "lectura rechazada: JSON ilegible");
      return rechazar("json_ilegible", CODIGO_PUBACK.payloadInvalido);
    }
    const parsed = telemetria.safeParse(json);
    if (!parsed.success) {
      deps.log.warn(
        { nodoId, motivos: parsed.error.issues.map((i) => i.path.join(".")) },
        "lectura rechazada: payload inválido",
      );
      return rechazar("payload_invalido", CODIGO_PUBACK.payloadInvalido);
    }
    const lectura = parsed.data;

    const tsMs = lectura.ts * 1000;
    const ahoraMs = ahora();
    if (tsMs > ahoraMs + MAX_ADELANTO_MS || tsMs < ahoraMs - MAX_ANTIGUEDAD_MS) {
      deps.log.warn({ nodoId, ts: lectura.ts }, "lectura rechazada: reloj del nodo fuera de rango");
      return rechazar("reloj_fuera_de_rango", CODIGO_PUBACK.payloadInvalido);
    }

    const meta = await nodoAutorizado(nodoId);
    if (!meta) return rechazar("nodo_no_autorizado", CODIGO_PUBACK.nodoNoAutorizado);

    await deps.encolar({
      lecturas: [
        {
          nodoId,
          espacioId: meta.espacioId,
          ts: tsMs,
          seq: lectura.seq,
          ph: lectura.ph ?? null,
          temperatura: lectura.t ?? null,
          conductividad: lectura.ec ?? null,
          turbidez: lectura.turb ?? null,
          tds: lectura.tds ?? null,
          recibidoEn: ahoraMs,
        },
      ],
    });
    // Después de encolar: un fallo aquí no debe reencolar la lectura (la base la deduplica, pero sobra trabajo).
    if (deps.seguirSeq) {
      const perdidas = await deps.seguirSeq(nodoId, lectura.seq).catch(() => 0);
      if (perdidas > 0) {
        m?.huecos(perdidas);
        deps.log.warn({ nodoId, perdidas }, "huecos en la secuencia de lecturas");
      }
    }
    return CODIGO_PUBACK.ok;
  }

  async function estadoDe(nodoId: string, carga: Buffer): Promise<number> {
    const parsed = estadoConexion.safeParse(carga.toString("utf8").trim());
    if (!parsed.success) {
      deps.log.warn({ nodoId }, "estado rechazado: valor desconocido");
      return rechazar("payload_invalido", CODIGO_PUBACK.payloadInvalido);
    }
    const meta = await nodoAutorizado(nodoId);
    if (!meta) return rechazar("nodo_no_autorizado", CODIGO_PUBACK.nodoNoAutorizado);
    await deps.encolarEvento({
      tipo: "estado",
      nodoId,
      espacioId: meta.espacioId,
      estado: parsed.data,
      recibidoEn: ahora(),
    });
    return CODIGO_PUBACK.ok;
  }

  async function atributosDe(nodoId: string, carga: Buffer): Promise<number> {
    let json: unknown;
    try {
      json = JSON.parse(carga.toString("utf8"));
    } catch {
      return rechazar("json_ilegible", CODIGO_PUBACK.payloadInvalido);
    }
    const parsed = atributosV1.safeParse(json);
    if (!parsed.success) {
      deps.log.warn({ nodoId }, "atributos rechazados: payload inválido");
      return rechazar("payload_invalido", CODIGO_PUBACK.payloadInvalido);
    }
    const meta = await nodoAutorizado(nodoId);
    if (!meta) return rechazar("nodo_no_autorizado", CODIGO_PUBACK.nodoNoAutorizado);
    await deps.encolarEvento({
      tipo: "atributos",
      nodoId,
      espacioId: meta.espacioId,
      fw: parsed.data.fw,
      recibidoEn: ahora(),
    });
    return CODIGO_PUBACK.ok;
  }

  return {
    async manejar(topico, carga) {
      const t = parsearTopico(topico);
      if (!t || !["telemetry", "status", "attributes"].includes(t.tipo)) {
        deps.log.warn({ topico }, "tópico no válido");
        return rechazar("topico_invalido", CODIGO_PUBACK.topicoInvalido);
      }
      m?.recibida(t.tipo as "telemetry" | "status" | "attributes");
      switch (t.tipo) {
        case "status":
          return estadoDe(t.deviceId, carga);
        case "attributes":
          return atributosDe(t.deviceId, carga);
        default:
          return telemetriaDe(t.deviceId, carga);
      }
    },
  };
}
