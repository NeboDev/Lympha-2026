import {
  GUIA_CALIBRACION,
  type ParametroCalibrable,
  type PasoGuia,
  type PuntoCalibracion,
} from "@lympha/calibracion";

/**
 * Máquina de estados del asistente (pura, para probarla sin pantalla). Cada punto tiene dos momentos: `preparar`
 * (la persona cambia la solución y confirma el valor real del patrón) y `midiendo` (se espera a que la lectura
 * se estabilice). Medir solo empieza cuando la persona dice que la sonda ya está en la solución: si no, las
 * lecturas aún de la solución anterior parecerían «estables».
 */

export interface PuntoCapturado extends PuntoCalibracion {
  titulo: string;
}

export type FaseAsistente = "elegir" | "punto" | "resumen";

export interface EstadoAsistente {
  fase: FaseAsistente;
  parametro: ParametroCalibrable | null;
  /** Paso de la guía en curso. */
  indice: number;
  momento: "preparar" | "midiendo";
  /** Valor real de cada solución, editable (el frasco puede traer otro valor que el propuesto). */
  referencias: number[];
  capturados: PuntoCapturado[];
  /** Hora de la última lectura al empezar a medir: solo cuentan las posteriores. */
  ancla: string | null;
}

export const estadoInicial: EstadoAsistente = {
  fase: "elegir",
  parametro: null,
  indice: 0,
  momento: "preparar",
  referencias: [],
  capturados: [],
  ancla: null,
};

export type AccionAsistente =
  | { tipo: "elegir"; parametro: ParametroCalibrable }
  | { tipo: "referencia"; indice: number; valor: number }
  | { tipo: "medir"; ancla: string | null }
  | { tipo: "capturar"; crudo: number }
  | { tipo: "omitir" }
  | { tipo: "terminar" }
  | { tipo: "repetir"; indice: number }
  | { tipo: "reiniciar" };

export const pasosDe = (p: ParametroCalibrable): PasoGuia[] => GUIA_CALIBRACION[p].pasos;
export const minimoDe = (p: ParametroCalibrable): number => GUIA_CALIBRACION[p].minimo;

/** Siguiente paso sin capturar, o `null` si ya se recorrieron todos. */
function siguiente(estado: EstadoAsistente, desde: number): number | null {
  if (!estado.parametro) return null;
  const total = pasosDe(estado.parametro).length;
  for (let i = desde; i < total; i++) {
    if (
      !estado.capturados.some(
        (c) => c.titulo === pasosDe(estado.parametro as ParametroCalibrable)[i]?.titulo,
      )
    ) {
      return i;
    }
  }
  return null;
}

export function reducirAsistente(
  estado: EstadoAsistente,
  accion: AccionAsistente,
): EstadoAsistente {
  switch (accion.tipo) {
    case "elegir":
      return {
        ...estadoInicial,
        fase: "punto",
        parametro: accion.parametro,
        referencias: pasosDe(accion.parametro).map((p) => p.referencia),
      };
    case "referencia":
      return {
        ...estado,
        referencias: estado.referencias.map((r, i) => (i === accion.indice ? accion.valor : r)),
      };
    case "medir":
      return estado.fase === "punto"
        ? { ...estado, momento: "midiendo", ancla: accion.ancla }
        : estado;
    case "capturar": {
      if (estado.fase !== "punto" || estado.momento !== "midiendo" || !estado.parametro)
        return estado;
      const paso = pasosDe(estado.parametro)[estado.indice];
      const referencia = estado.referencias[estado.indice];
      if (!paso || referencia === undefined) return estado;
      const capturados = [
        ...estado.capturados.filter((c) => c.titulo !== paso.titulo),
        { titulo: paso.titulo, crudo: accion.crudo, referencia },
      ];
      const conCaptura = { ...estado, capturados };
      const proximo = siguiente(conCaptura, estado.indice + 1) ?? siguiente(conCaptura, 0);
      // al terminar los obligatorios no se empuja a los opcionales: se ofrecen, pero se puede pasar al resumen
      return proximo === null
        ? { ...conCaptura, fase: "resumen", momento: "preparar", ancla: null }
        : { ...conCaptura, indice: proximo, momento: "preparar", ancla: null };
    }
    case "omitir": {
      if (estado.fase !== "punto") return estado;
      const proximo = siguiente(estado, estado.indice + 1);
      return proximo === null
        ? { ...estado, fase: "resumen", momento: "preparar", ancla: null }
        : { ...estado, indice: proximo, momento: "preparar", ancla: null };
    }
    case "terminar":
      return estado.fase === "punto"
        ? { ...estado, fase: "resumen", momento: "preparar", ancla: null }
        : estado;
    case "repetir":
      return {
        ...estado,
        fase: "punto",
        indice: accion.indice,
        momento: "preparar",
        ancla: null,
        capturados: estado.capturados.filter(
          (c) =>
            c.titulo !== (estado.parametro ? pasosDe(estado.parametro)[accion.indice]?.titulo : ""),
        ),
      };
    case "reiniciar":
      return estadoInicial;
  }
}

/** ¿Ya hay puntos suficientes para calcular la recta? */
export function puedeTerminar(estado: EstadoAsistente): boolean {
  return estado.parametro !== null && estado.capturados.length >= minimoDe(estado.parametro);
}
