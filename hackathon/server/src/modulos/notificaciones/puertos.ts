import type { ObjectId } from "mongodb";

export type TipoAviso = "abre" | "escala" | "recordatorio" | "cierra";

/** Un mensaje por enviar (bandeja de salida). La `clave` única evita duplicados al reintentar. */
export type AvisoDoc = {
  _id: ObjectId;
  /** Única: p. ej. `<alerta>:abre`. Encolar dos veces la misma clave no duplica el aviso. */
  clave: string;
  comunidad_id: ObjectId;
  nodo_id: ObjectId | null;
  alerta_id: ObjectId | null;
  tipo: TipoAviso;
  texto: string;
  creado: Date;
  estado: "pendiente" | "enviado" | "fallido";
  intentos: number;
  proximo_intento: Date;
  /** Arrendamiento: mientras sea futuro, otro proceso no toma este aviso. */
  bloqueado_hasta: Date | null;
  enviado: Date | null;
  ultimo_error: string | null;
};

/** Lo que el enviador necesita de la base. */
export interface AlmacenAvisos {
  /** Toma (con arrendamiento) el aviso pendiente más antiguo que ya toque enviar. */
  tomarSiguiente(ahora: Date, arriendoMs: number): Promise<AvisoDoc | null>;
  marcarEnviado(id: ObjectId, ahora: Date): Promise<void>;
  reprogramar(id: ObjectId, proximoIntento: Date, error: string): Promise<void>;
  marcarFallido(id: ObjectId, error: string): Promise<void>;
  /** Chat de Telegram vinculado a la comunidad, o null. */
  chatDe(comunidadId: ObjectId): Promise<number | null>;
}

/** Lo que el enviador necesita de Telegram. Los errores pueden traer `codigo` y `reintentarEnS`. */
export interface EnviadorTelegram {
  enviarMensaje(chatId: number, texto: string): Promise<void>;
}

export type LoggerAvisos = {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
};
