import { nivelPorPuntaje } from "./evaluar.ts";
import type { ConfigPerfil, Nivel } from "./tipos.ts";

/**
 * Histéresis (RF-21, RF-30): el estado mostrado cambia solo ante un cambio SOSTENIDO.
 * Dos mecanismos que se suman:
 *   1. Margen en el umbral: para mejorar de nivel el puntaje debe superar el umbral + `margen`,
 *      así un puntaje que ronda el umbral no oscila entre dos niveles.
 *   2. Confirmación: el candidato debe repetirse N lecturas seguidas (menos para empeorar que para
 *      mejorar). La racha cuenta cualquier candidato en el mismo sentido y se confirma el menos
 *      extremo de la racha, de modo que una tendencia irregular no reinicia la cuenta.
 */

export interface Pendiente<T> {
  sentido: "peor" | "mejor";
  /** Lecturas consecutivas en este sentido. */
  cuenta: number;
  /** Valor que se confirmará: el menos extremo de la racha. */
  valor: T;
}

/** Un canal es un valor confirmado más el cambio que está esperando confirmación. */
export interface Canal<T> {
  actual: T | null;
  pendiente: Pendiente<T> | null;
}

export const canalNuevo = <T>(actual: T | null = null): Canal<T> => ({ actual, pendiente: null });

/**
 * Avanza un canal con el candidato de la última lectura. `orden` va del mejor al peor valor.
 * Sin valor confirmado todavía, el primer candidato se adopta de inmediato.
 */
export function avanzarCanal<T extends string>(
  canal: Canal<T>,
  candidato: T,
  orden: readonly T[],
  confirmar: { empeorar: number; mejorar: number },
): Canal<T> {
  if (canal.actual === null) return { actual: candidato, pendiente: null };

  const severidad = (v: T): number => orden.indexOf(v);
  const diferencia = severidad(candidato) - severidad(canal.actual);
  if (diferencia === 0) return { actual: canal.actual, pendiente: null };

  const sentido = diferencia > 0 ? "peor" : "mejor";
  const previo = canal.pendiente;
  let pendiente: Pendiente<T>;
  if (previo && previo.sentido === sentido) {
    const masModerado =
      sentido === "peor"
        ? severidad(candidato) < severidad(previo.valor)
        : severidad(candidato) > severidad(previo.valor);
    pendiente = {
      sentido,
      cuenta: previo.cuenta + 1,
      valor: masModerado ? candidato : previo.valor,
    };
  } else {
    pendiente = { sentido, cuenta: 1, valor: candidato };
  }

  const necesarias = sentido === "peor" ? confirmar.empeorar : confirmar.mejorar;
  if (pendiente.cuenta >= necesarias) return { actual: pendiente.valor, pendiente: null };
  return { actual: canal.actual, pendiente };
}

const UMBRAL_INFERIOR = (perfil: ConfigPerfil, nivel: Nivel): number => {
  switch (nivel) {
    case "buena":
      return perfil.umbrales.buena;
    case "regular":
      return perfil.umbrales.regular;
    case "mala":
      return perfil.umbrales.mala;
    default:
      return Number.NEGATIVE_INFINITY;
  }
};

const ORDEN_NIVELES: readonly Nivel[] = ["buena", "regular", "mala", "critica", "sin_datos"];

/**
 * Nivel candidato de la lectura actual dado el nivel confirmado: aplica el margen al mejorar.
 * `puntaje` nulo (sin peso válido suficiente) significa `sin_datos`.
 */
export function nivelCandidato(
  perfil: ConfigPerfil,
  puntaje: number | null,
  actual: Nivel | null,
): Nivel {
  if (puntaje === null) return "sin_datos";
  let nivel: Nivel = nivelPorPuntaje(perfil, puntaje);
  if (actual === null || actual === "sin_datos") return nivel;

  const sev = (n: Nivel) => ORDEN_NIVELES.indexOf(n);
  while (
    sev(nivel) < sev(actual) &&
    puntaje < UMBRAL_INFERIOR(perfil, nivel) + perfil.histeresis.margen
  ) {
    nivel = ORDEN_NIVELES[sev(nivel) + 1] as Nivel;
  }
  return nivel;
}
