import type { NormaParametro, ReglasParametro } from "../../dominio/catalogo.ts";

/** Estado del agua para un parámetro. `sin_datos` lo decide la ingesta (seq detenido), no la evaluación. */
export type Estado = "en_rango" | "atencion" | "fuera_de_rango" | "critico" | "revisar_sensor";

export type Lectura = { ts: Date; valor: number };

export type MotivoSensor = "fuera_fisico" | "riel" | "pegado" | "calibracion" | "nodo";

export type EntradaEvaluacion = {
  /** Límites de la norma del parámetro (cualquiera puede ser null). */
  norma: Pick<NormaParametro, "min" | "max">;
  reglas: ReglasParametro;
  /** Lecturas recientes, en cualquier orden; la evaluación las ordena por `ts`. */
  ventana: Lectura[];
  /** Estado ya confirmado en la evaluación anterior; sirve para la histéresis. */
  previo?: Estado | null;
  /** Pendiente de la última calibración como % de Nernst, si se conoce. */
  pendientePctNernst?: number | null;
  /** Estado que reporta el propio nodo (V4): 3 = error de sensor. */
  estadoNodo?: number | null;
};

export type ResultadoEvaluacion = {
  estado: Estado;
  /** Última lectura considerada. */
  valor: number;
  /** `true` si la ventana es larga y casi no se mueve. */
  estable: boolean;
  /** Cambio frente a la lectura de hace `ventana_min`, si hay una. */
  cambio: number | null;
  cambioRapido: boolean;
  /** Distancia al límite más cercano: positiva si está fuera, negativa si está dentro. */
  distanciaFuera: number;
  /** Causas del estado `revisar_sensor` (vacío si el sensor es confiable). */
  motivosSensor: MotivoSensor[];
};
