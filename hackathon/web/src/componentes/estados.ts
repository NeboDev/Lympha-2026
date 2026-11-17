import type { EstadoAgua, Nodo } from "../api/tipos.ts";

/**
 * Cómo se ve cada estado del agua. El estado NUNCA va solo en color: siempre símbolo + palabra
 * (docs/IDENTIDAD_VISUAL.md §3). Los textos de «qué hacer» siguen la voz de §8: un vecino que sabe, sin
 * culpar y sin jerga; ninguno dice «potable» ni «seguro» (lo verifica `estados.test.ts`).
 */

export type EstadoVisual = EstadoAgua | "sin_conexion" | "sin_lecturas";

export type IconoEstado =
  | "circulo-check"
  | "triangulo-alerta"
  | "rombo-alerta"
  | "cuadro-x"
  | "ayuda";

export type InfoEstado = {
  palabra: string;
  icono: IconoEstado;
  /** Variable CSS del relleno (de tokens.css). */
  color: string;
  /** Variable CSS del relleno suave. */
  suave: string;
  queHacer: string;
};

export const ESTADOS_UI: Record<EstadoVisual, InfoEstado> = {
  en_rango: {
    palabra: "En rango",
    icono: "circulo-check",
    color: "var(--good)",
    suave: "var(--good-soft)",
    queHacer: "Todo en orden. Seguimos vigilando el pH.",
  },
  atencion: {
    palabra: "Atención",
    icono: "triangulo-alerta",
    color: "var(--fair)",
    suave: "var(--fair-soft)",
    queHacer: "El pH se está acercando a los límites. Vale la pena estar al pendiente.",
  },
  fuera_de_rango: {
    palabra: "Fuera de rango",
    icono: "rombo-alerta",
    color: "var(--poor)",
    suave: "var(--poor-soft)",
    queHacer:
      "El pH salió del rango recomendado. Evita usar el agua para beber o cocinar hasta revisar, y avísale a la persona responsable.",
  },
  critico: {
    palabra: "Crítico",
    icono: "cuadro-x",
    color: "var(--crit)",
    suave: "var(--crit-soft)",
    queHacer:
      "El pH está muy fuera de rango. Revisa el tinaco ahora y avísale a la persona responsable.",
  },
  revisar_sensor: {
    palabra: "Revisar sensor",
    icono: "ayuda",
    color: "var(--none)",
    suave: "var(--none-soft)",
    queHacer:
      "La lectura no es confiable. No tomes decisiones con este dato hasta revisar y calibrar la sonda.",
  },
  sin_conexion: {
    palabra: "Sin conexión",
    icono: "ayuda",
    color: "var(--none)",
    suave: "var(--none-soft)",
    queHacer: "Dejamos de recibir datos del nodo. Revisa que esté encendido y con internet.",
  },
  sin_lecturas: {
    palabra: "Sin lecturas",
    icono: "ayuda",
    color: "var(--none)",
    suave: "var(--none-soft)",
    queHacer:
      "Todavía no llegan lecturas de este nodo. Revisa que esté encendido y conectado a Blynk.",
  },
};

/** El estado que se le muestra a la persona: lo que el servidor evaluó, salvo que el nodo no esté enviando datos. */
export function estadoVisual(n: Pick<Nodo, "conexion" | "ultimo">): EstadoVisual {
  if (n.conexion === "sin_datos") return "sin_conexion";
  if (n.conexion === "sin_lecturas" || !n.ultimo) return "sin_lecturas";
  return n.ultimo.estado ?? "sin_lecturas";
}
