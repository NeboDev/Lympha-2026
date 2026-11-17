import type { ObjectId } from "mongodb";
import type { NodoDoc } from "../nodos/index.ts";
import type { AvisoDoc } from "../notificaciones/index.ts";

export type TipoAlerta = "nivel" | "cambio_rapido" | "sensor" | "sin_conexion";
export type SeveridadAlerta = "atencion" | "alta" | "critica";

export type AlertaDoc = {
  _id: ObjectId;
  nodo_id: ObjectId;
  comunidad_id: ObjectId;
  tipo: TipoAlerta;
  /** null para las alertas del nodo completo (sin conexión). */
  parametro: string | null;
  severidad: SeveridadAlerta;
  severidad_maxima: SeveridadAlerta;
  estado: "abierta" | "cerrada";
  abierta: Date;
  cerrada: Date | null;
  /** null = todavía no se ha encolado ningún aviso de esta alerta. */
  ultimo_aviso: Date | null;
  recordatorios: number;
  valor_apertura: number | null;
  valor_cierre: number | null;
};

export type EventoAlerta = {
  nodo_id: ObjectId;
  comunidad_id: ObjectId;
  ts: Date;
  tipo: "alerta_abre" | "alerta_cierra";
  severidad: "info" | "atencion" | "alta";
  parametro: string | null;
  mensaje: string;
  datos: Record<string, unknown>;
  autor_uid: null;
};

/** Lo que las alertas necesitan de la base. Cada operación condicional es idempotente. */
export interface AlmacenAlertas {
  alertasAbiertasDeNodo(nodoId: ObjectId): Promise<AlertaDoc[]>;
  alertasAbiertas(): Promise<AlertaDoc[]>;
  nodo(id: ObjectId): Promise<NodoDoc | null>;
  /** ¿La comunidad tiene un chat de Telegram vinculado? */
  hayChat(comunidadId: ObjectId): Promise<boolean>;
  /** «duplicada» si ya hay una alerta abierta igual (nodo, tipo, parámetro). */
  insertarAlerta(alerta: AlertaDoc): Promise<"insertada" | "duplicada">;
  /** `true` solo si estaba abierta y la cerró esta llamada. */
  cerrarAlerta(id: ObjectId, ts: Date, valor: number | null): Promise<boolean>;
  /** `true` solo si tenía la severidad `desde` y la cambió esta llamada. */
  cambiarSeveridad(
    id: ObjectId,
    desde: SeveridadAlerta,
    a: SeveridadAlerta,
    maxima: SeveridadAlerta,
  ): Promise<boolean>;
  /** Anota que se encoló un aviso (y, si es un recordatorio, cuántos van). */
  marcarAviso(id: ObjectId, ts: Date, recordatorios?: number): Promise<void>;
  /** «duplicado» si ya existía un aviso con esa clave. */
  encolarAviso(aviso: AvisoDoc): Promise<"encolado" | "duplicado">;
  registrarEvento(evento: EventoAlerta): Promise<void>;
}

export type LoggerAlertas = {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
};
