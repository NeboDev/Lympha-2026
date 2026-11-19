import { fechaMx, horaMx } from "../util/formato.ts";

const DOS_DIAS_MS = 2 * 86_400_000;

const soloDia = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City",
  day: "numeric",
  month: "short",
});

/**
 * Cómo se escribe un instante en el eje X de la gráfica: la hora si el periodo es corto y el día si es largo.
 * En el cuadro que sale al pasar el cursor va completo (día y hora).
 */
export function formatoEjeX(t: Date, desde: Date, hasta: Date, completo: boolean): string {
  if (completo) return fechaMx(t);
  return hasta.getTime() - desde.getTime() <= DOS_DIAS_MS ? horaMx(t) : soloDia.format(t);
}
