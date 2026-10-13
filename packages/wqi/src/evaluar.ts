import {
  type ConfigPerfil,
  type Direccion,
  type Mediciones,
  type Nivel,
  PARAMETROS,
  type Parametro,
  type PuntoCurva,
} from "./tipos.ts";

/** Redondeo a 2 decimales: así el resultado es idéntico en cualquier máquina y cabe en numeric(5,2). */
export const redondear = (x: number): number => Math.round(x * 100) / 100;

/** Puntaje 0–100 de un valor según su curva (interpolación lineal; los extremos se repiten). */
export function puntajeDeCurva(curva: readonly PuntoCurva[], valor: number): number {
  const primero = curva[0];
  const ultimo = curva[curva.length - 1];
  if (!primero || !ultimo) throw new Error("curva vacía");
  if (valor <= primero[0]) return primero[1];
  if (valor >= ultimo[0]) return ultimo[1];
  for (let i = 1; i < curva.length; i++) {
    const b = curva[i] as PuntoCurva;
    if (valor <= b[0]) {
      const a = curva[i - 1] as PuntoCurva;
      return a[1] + ((b[1] - a[1]) * (valor - a[0])) / (b[0] - a[0]);
    }
  }
  return ultimo[1];
}

/** Hacia qué lado del tramo ideal (puntaje máximo de la curva) cae un valor. */
export function direccionDe(perfil: ConfigPerfil, parametro: Parametro, valor: number): Direccion {
  const curva = perfil.parametros[parametro].curva;
  const maximo = Math.max(...curva.map((p) => p[1]));
  const inicioIdeal = curva.find((p) => p[1] === maximo) as PuntoCurva;
  return valor < inicioIdeal[0] ? "bajo" : "alto";
}

/** Nivel que corresponde a un puntaje, sin histéresis. */
export function nivelPorPuntaje(
  perfil: ConfigPerfil,
  puntaje: number,
): Exclude<Nivel, "sin_datos"> {
  const u = perfil.umbrales;
  if (puntaje >= u.buena) return "buena";
  if (puntaje >= u.regular) return "regular";
  if (puntaje >= u.mala) return "mala";
  return "critica";
}

export interface Evaluacion {
  version: string;
  /** Promedio ponderado de los subíndices con dato; `null` si falta peso válido. */
  wqi: number | null;
  /** Lo que decide el nivel: el menor entre el WQI y el peor subíndice de un parámetro que limita (RF-19). */
  puntajeDecision: number | null;
  /** Nivel instantáneo, sin histéresis. */
  nivel: Nivel;
  subindices: Partial<Record<Parametro, number>>;
  /** Parámetro responsable (el peor subíndice, con prioridad a los que limitan), si alguno no llega a "buena". */
  limitante: { parametro: Parametro; direccion: Direccion } | null;
}

/**
 * Evalúa un conjunto de mediciones ya depuradas (sin picos ni sensores dudosos; ver `motor.ts`).
 * Es una función pura y determinista: mismas mediciones y misma versión, mismo resultado (RNF-24).
 */
export function evaluar(perfil: ConfigPerfil, mediciones: Mediciones): Evaluacion {
  const subindices: Partial<Record<Parametro, number>> = {};
  let sumaPesos = 0;
  let sumaPonderada = 0;
  let peorLimitante = Number.POSITIVE_INFINITY;
  let peorQueLimita: { parametro: Parametro; puntaje: number } | null = null;
  let peorCualquiera: { parametro: Parametro; puntaje: number } | null = null;

  for (const parametro of PARAMETROS) {
    const valor = mediciones[parametro];
    if (valor === null || !Number.isFinite(valor)) continue;
    const cfg = perfil.parametros[parametro];
    const puntaje = puntajeDeCurva(cfg.curva, valor);
    subindices[parametro] = redondear(puntaje);
    sumaPesos += cfg.peso;
    sumaPonderada += cfg.peso * puntaje;
    if (cfg.limita) {
      peorLimitante = Math.min(peorLimitante, puntaje);
      if (!peorQueLimita || puntaje < peorQueLimita.puntaje) peorQueLimita = { parametro, puntaje };
    }
    if (!peorCualquiera || puntaje < peorCualquiera.puntaje)
      peorCualquiera = { parametro, puntaje };
  }

  if (sumaPesos < perfil.pesoMinimoValido - 1e-9) {
    return {
      version: perfil.version,
      wqi: null,
      puntajeDecision: null,
      nivel: "sin_datos",
      subindices,
      limitante: null,
    };
  }

  const wqi = redondear(sumaPonderada / sumaPesos);
  const puntajeDecision = redondear(Math.min(wqi, peorLimitante));
  const nivel = nivelPorPuntaje(perfil, puntajeDecision);

  let limitante: Evaluacion["limitante"] = null;
  // Se culpa primero a un parámetro que limita; la temperatura solo si es lo único que está mal.
  const culpable =
    peorQueLimita && peorQueLimita.puntaje < perfil.umbrales.buena ? peorQueLimita : peorCualquiera;
  if (culpable && culpable.puntaje < perfil.umbrales.buena) {
    const valor = mediciones[culpable.parametro] as number;
    limitante = {
      parametro: culpable.parametro,
      direccion: direccionDe(perfil, culpable.parametro, valor),
    };
  }
  return { version: perfil.version, wqi, puntajeDecision, nivel, subindices, limitante };
}
