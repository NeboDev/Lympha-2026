/**
 * Lo único específico de pH: Nernst, calibración de 2 puntos y fracción de HOCl.
 * Funciones puras. Ver docs/cloracion-ph.md para la química y sus límites.
 */

const KELVIN = 273.15;
/** Constante de Nernst: mV por unidad de pH y por kelvin (2.303·R/F · 1000). */
const NERNST_MV_POR_PH_POR_K = 0.1984;

/** Pendiente teórica (magnitud) de una sonda de pH, en mV por unidad de pH. ≈ 59.16 a 25 °C. */
export function pendienteNernst(tempC: number): number {
  return NERNST_MV_POR_PH_POR_K * (tempC + KELVIN);
}

export type PuntoCalibracion = { ph: number; mv: number };

export type Calibracion = {
  /** mV por unidad de pH (negativa: el voltaje baja al subir el pH). */
  pendienteMvPorPh: number;
  /** mV medidos a pH 7 (punto cero de la sonda). */
  offsetMv: number;
  /** |pendiente| como porcentaje de la teórica de Nernst a la temperatura de calibración. */
  pendientePctNernst: number;
  tempCalC: number;
};

/** Calibración de 2 puntos (p. ej. buffers 4 y 7). Los puntos deben tener pH distintos. */
export function calibrar2Puntos(a: PuntoCalibracion, b: PuntoCalibracion, tempC: number) {
  if (a.ph === b.ph) throw new Error("Los dos puntos de calibración deben tener pH distintos");
  const pendiente = (b.mv - a.mv) / (b.ph - a.ph);
  const offset = a.mv + pendiente * (7 - a.ph);
  const cal: Calibracion = {
    pendienteMvPorPh: pendiente,
    offsetMv: offset,
    pendientePctNernst: (Math.abs(pendiente) / pendienteNernst(tempC)) * 100,
    tempCalC: tempC,
  };
  return cal;
}

/** mV → pH con compensación de la pendiente por temperatura (Nernst). */
export function phDesdeMv(mv: number, cal: Calibracion, tempC: number): number {
  const factor = (tempC + KELVIN) / (cal.tempCalC + KELVIN);
  return 7 + (mv - cal.offsetMv) / (cal.pendienteMvPorPh * factor);
}

/** pKa del ácido hipocloroso (Morris, 1966; válido ≈ 4–34 °C). ≈ 7.54 a 25 °C. */
export function pKaHOCl(tempC: number): number {
  const t = tempC + KELVIN;
  return 3000 / t - 10.0686 + 0.0253 * t;
}

/** Fracción (0–1) del cloro libre presente como HOCl, la forma más efectiva. */
export function fraccionHOCl(ph: number, tempC: number): number {
  return 1 / (1 + 10 ** (ph - pKaHOCl(tempC)));
}
