/**
 * Efectividad teórica del cloro libre según el pH: qué fracción está como ácido hipocloroso (HOCl), la
 * forma más efectiva. Es la misma fórmula del servidor (`server/src/dominio/ph.ts`, docs/cloracion-ph.md);
 * se repite aquí porque la API no la entrega. Es una estimación: Atl no mide cloro.
 */

const KELVIN = 273.15;

/** pKa del ácido hipocloroso (Morris, 1966; válido ≈ 4–34 °C). ≈ 7.54 a 25 °C. */
export function pKaHOCl(tempC: number): number {
  const t = tempC + KELVIN;
  return 3000 / t - 10.0686 + 0.0253 * t;
}

/** Fracción (0–1) del cloro libre presente como HOCl. */
export function fraccionHOCl(ph: number, tempC: number): number {
  return 1 / (1 + 10 ** (ph - pKaHOCl(tempC)));
}

export const TEMPERATURA_SUPUESTA_C = 25;

/** Porcentaje entero para mostrar («~52 %»); `null` si el pH no es un número razonable. */
export function efectividadCloroPct(
  ph: number | null | undefined,
  tempC = TEMPERATURA_SUPUESTA_C,
): number | null {
  if (ph === null || ph === undefined || !Number.isFinite(ph) || ph < 0 || ph > 14) return null;
  return Math.round(fraccionHOCl(ph, tempC) * 100);
}
