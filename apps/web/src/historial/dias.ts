import { type DiaHistorial, ZONA_HISTORIAL } from "@lympha/contracts";

/** Día calendario `AAAA-MM-DD` en la zona del historial (México), el mismo con que la API agrupa los días. */
export function diaEnZona(instante: number): string {
  return new Date(instante).toLocaleDateString("sv-SE", { timeZone: ZONA_HISTORIAL });
}

/** Suma (o resta) días a un `AAAA-MM-DD` sin depender de la zona del navegador. */
export function sumarDias(dia: string, n: number): string {
  const fecha = new Date(`${dia}T12:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + n);
  return fecha.toISOString().slice(0, 10);
}

/** Los `dias` días hasta hoy inclusive, del más antiguo al más reciente. */
export function rangoDias(dias: number, ahora: number): string[] {
  const hoy = diaEnZona(ahora);
  return Array.from({ length: dias }, (_, i) => sumarDias(hoy, i - (dias - 1)));
}

export interface CeldaDia {
  dia: string;
  /** `null` = ningún dato ese día (no es lo mismo que «sin_datos»: aquí ni siquiera hubo evaluaciones). */
  datos: DiaHistorial | null;
}

/** Une lo que devolvió la API con el rango completo: los días sin registro quedan como celdas vacías. */
export function completarRango(historial: DiaHistorial[], dias: number, ahora: number): CeldaDia[] {
  const porDia = new Map(historial.map((d) => [d.dia, d]));
  return rangoDias(dias, ahora).map((dia) => ({ dia, datos: porDia.get(dia) ?? null }));
}

/** «miércoles 14 de octubre». */
export function etiquetaDia(dia: string): string {
  return new Date(`${dia}T12:00:00Z`).toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/** «14 oct», para el eje de una gráfica. */
export function etiquetaCorta(dia: string): string {
  return new Date(`${dia}T12:00:00Z`).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Número del día del mes sin ceros a la izquierda. */
export const numeroDia = (dia: string): string => String(Number(dia.slice(8, 10)));
