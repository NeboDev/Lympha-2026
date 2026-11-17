/**
 * Lo único específico de pH en la web: la escala de color tipo papel indicador. El resto de la web trata a
 * todos los parámetros igual (nombre, unidad y norma vienen del catálogo del servidor).
 */

export const PH_MIN = 0;
export const PH_MAX = 14;

/** ¿Es el pH? Es la única comprobación por nombre de parámetro de toda la web. */
export const esPh = (id: string): boolean => id === "ph";

/** Posición (0–100) de un valor en la escala 0–14, sin salirse de los extremos. */
export function posicionPh(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return ((Math.min(PH_MAX, Math.max(PH_MIN, v)) - PH_MIN) / (PH_MAX - PH_MIN)) * 100;
}

/** Degradado de papel indicador (docs/IDENTIDAD_VISUAL.md §3): ácido ≈4, neutro ≈7, básico ≈10. */
export const DEGRADADO_PH = [
  `var(--ph-acido) ${posicionPh(4).toFixed(1)}%`,
  `var(--ph-neutro) ${posicionPh(7).toFixed(1)}%`,
  `var(--ph-basico) ${posicionPh(10).toFixed(1)}%`,
].join(", ");
