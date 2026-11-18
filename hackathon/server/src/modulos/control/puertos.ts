import type { ObjectId } from "mongodb";
import type { ConfigActuador, NodoDoc } from "../nodos/index.ts";

export type EstadoAccion =
  | "pendiente" // pedida, espera la confirmación de una persona responsable
  | "en_curso" // confirmada y enviada a Blynk; sigue hasta `fin`
  | "terminada" // llegó a su fin y se mandó apagar
  | "detenida" // se detuvo antes de tiempo (una persona o la regla de seguridad)
  | "cancelada" // la persona dijo «no»
  | "expirada" // nadie confirmó a tiempo
  | "rechazada" // al confirmar, un enclavamiento lo impidió
  | "fallida"; // Blynk no recibió la orden

/** Estados en los que una acción sigue viva: solo puede haber una por nodo. */
export const ESTADOS_ACTIVOS: readonly EstadoAccion[] = ["pendiente", "en_curso"];

export type AccionDoc = {
  _id: ObjectId;
  nodo_id: ObjectId;
  comunidad_id: ObjectId;
  tipo: "pulso";
  duracion_s: number;
  estado: EstadoAccion;
  solicitada: Date;
  solicita_uid: string;
  /** Hasta cuándo se puede confirmar. */
  expira: Date;
  motivo: string | null;
  confirmada: Date | null;
  confirma_uid: string | null;
  inicio: Date | null;
  fin: Date | null;
  /** Por qué se detuvo, se rechazó o falló; `null` si todo salió como se pidió. */
  detalle: string | null;
  /** `true` si la detuvo la regla de seguridad y no una persona. */
  automatica: boolean;
  /** Se copió del nodo al pedirla: si después lo cambian, el registro dice cómo era entonces. */
  simulado: boolean;
};

export type EventoActuador = {
  nodo_id: ObjectId;
  comunidad_id: ObjectId;
  ts: Date;
  tipo: "actuador";
  severidad: "info" | "atencion";
  parametro: null;
  mensaje: string;
  datos: { accion_id: string; estado: EstadoAccion };
  autor_uid: string | null;
};

export interface AlmacenControl {
  /** Guarda (o quita, con `null`) la configuración del actuador en el nodo. */
  guardarConfig(nodoId: ObjectId, config: ConfigActuador | null): Promise<void>;
  /** «ocupado» si el nodo ya tiene una acción pendiente o en curso (índice único parcial). */
  insertar(accion: AccionDoc): Promise<"insertada" | "ocupado">;
  obtener(id: ObjectId, nodoId: ObjectId): Promise<AccionDoc | null>;
  /**
   * Cambia el estado **solo si** está en alguno de `desde` y devuelve la acción ya cambiada; `null` si
   * otra petición se adelantó. Es lo que evita que dos confirmaciones manden dos órdenes.
   */
  transicion(
    id: ObjectId,
    desde: readonly EstadoAccion[],
    cambios: Partial<Omit<AccionDoc, "_id">>,
  ): Promise<AccionDoc | null>;
  activa(nodoId: ObjectId): Promise<AccionDoc | null>;
  /** Cuándo terminó la última acción que llegó a ejecutarse (para el enfriamiento). */
  ultimoFin(nodoId: ObjectId): Promise<Date | null>;
  recientes(nodoId: ObjectId, limite: number): Promise<AccionDoc[]>;
  /** Pendientes con la confirmación vencida y pulsos en curso que ya llegaron a su fin. */
  vencidas(ahora: Date): Promise<AccionDoc[]>;
  /** Nodos con un actuador habilitado (para el barrido). */
  nodo(id: ObjectId): Promise<NodoDoc | null>;
  registrarEvento(evento: EventoActuador): Promise<void>;
}

/** Manda un 1 o un 0 al relevador. La implementación real habla con Blynk. */
export interface EscritorActuador {
  escribir(nodo: NodoDoc, pin: string, valor: 0 | 1): Promise<void>;
}

export type LoggerControl = {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
};

/** Lo que la API muestra de una acción (sin ids de personas). */
export type AccionVista = {
  id: string;
  estado: EstadoAccion;
  duracion_s: number;
  solicitada: Date;
  expira: Date;
  inicio: Date | null;
  fin: Date | null;
  motivo: string | null;
  detalle: string | null;
  automatica: boolean;
  simulado: boolean;
};

export type Enclavamiento = {
  codigo:
    | "sin_actuador"
    | "sin_datos"
    | "sensor"
    | "fuera_de_rango"
    | "pulso_en_curso"
    | "enfriamiento";
  mensaje: string;
};
