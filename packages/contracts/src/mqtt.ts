import { z } from "zod";

/** Versión actual del contrato nodo–servidor. El servidor acepta además las dos anteriores (RNF-29). */
export const VERSION_CONTRATO = 1;

const medicion = z.number().finite().nullable().optional();

/** Telemetría: `lympha/v1/d/{deviceId}/telemetry`. `ts` en segundos Unix (hora del nodo, NTP). */
export const telemetriaV1 = z
  .object({
    v: z.literal(1),
    ts: z.number().int().positive(),
    seq: z.number().int().nonnegative(),
    ph: medicion,
    t: medicion,
    ec: medicion,
    turb: medicion,
    tds: medicion,
  })
  .strict();
export type TelemetriaV1 = z.infer<typeof telemetriaV1>;

/** Todas las versiones de telemetría soportadas, discriminadas por `v`. */
export const telemetria = z.discriminatedUnion("v", [telemetriaV1]);
export type Telemetria = z.infer<typeof telemetria>;

export const atributosV1 = z
  .object({
    v: z.literal(1),
    fw: z.string().max(32),
    rssi: z.number().int().optional(),
    buffered: z.number().int().nonnegative().optional(),
    cal: z.record(z.string(), z.number().finite()).optional(),
  })
  .strict();
export type AtributosV1 = z.infer<typeof atributosV1>;

/** Estado de conexión (Last Will, retenido). Es una cadena simple, no JSON. */
export const estadoConexion = z.enum(["online", "offline"]);
export type EstadoConexion = z.infer<typeof estadoConexion>;

export const TIPOS_TOPICO = [
  "telemetry",
  "attributes",
  "status",
  "config",
  "cmd",
  "cmd/ack",
] as const;
export type TipoTopico = (typeof TIPOS_TOPICO)[number];

export const PREFIJO_TOPICO = "lympha/v1/d";

const uuid = z.string().uuid();

export function topico(deviceId: string, tipo: TipoTopico): string {
  return `${PREFIJO_TOPICO}/${deviceId}/${tipo}`;
}

export interface TopicoParseado {
  deviceId: string;
  tipo: TipoTopico;
}

/** Extrae `deviceId` y tipo de un tópico de nodo; devuelve `null` si no es un tópico válido. */
export function parsearTopico(valor: string): TopicoParseado | null {
  const prefijo = `${PREFIJO_TOPICO}/`;
  if (!valor.startsWith(prefijo)) return null;
  const resto = valor.slice(prefijo.length);
  const corte = resto.indexOf("/");
  if (corte < 0) return null;
  const deviceId = resto.slice(0, corte);
  const tipo = resto.slice(corte + 1);
  if (!uuid.safeParse(deviceId).success) return null;
  if (!(TIPOS_TOPICO as readonly string[]).includes(tipo)) return null;
  return { deviceId, tipo: tipo as TipoTopico };
}
