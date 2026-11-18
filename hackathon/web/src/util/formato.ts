const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Las fechas de Atl se muestran en hora de México (se guardan en UTC). */
function partes(d: Date) {
  const p = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return {
    dia: v("day"),
    mes: MESES[Number(v("month")) - 1] ?? "",
    anio: v("year"),
    h: v("hour"),
    m: v("minute"),
  };
}

/** «19 nov 2026, 09:00»; con `conHora = false`, «19 nov 2026». */
export function fechaMx(d: Date, conHora = true): string {
  const p = partes(d);
  const dia = `${p.dia} ${p.mes} ${p.anio}`;
  return conHora ? `${dia}, ${p.h}:${p.m}` : dia;
}

/** Solo la hora: «09:05». */
export function horaMx(d: Date): string {
  const p = partes(d);
  return `${p.h}:${p.m}`;
}

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

/** «hace 4 s», «hace 5 minutos», «hace 2 horas», «hace 3 días». */
export function haceLegible(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} ${plural(m, "minuto", "minutos")}`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} ${plural(h, "hora", "horas")}`;
  const d = Math.round(h / 24);
  return `hace ${d} días`;
}

/** Un valor con los decimales del catálogo; `—` si no hay. */
export function valorLegible(v: number | null | undefined, decimales: number): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(decimales);
}

/** Valor para un `<input type="datetime-local">` (hora de México): «2026-11-19T09:00». */
export function aInputLocal(d: Date): string {
  const f = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
  return f.replace(" ", "T");
}

/** Inverso de `aInputLocal`: interpreta «2026-11-19T09:00» como hora de México (UTC−6, sin horario de verano). */
export function desdeInputLocal(texto: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(texto);
  if (!m) return null;
  const [, a, mes, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const fecha = new Date(Date.UTC(a, mes - 1, d, h + 6, mi));
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/** Segundos que faltan para `hasta` (0 si ya pasó), redondeado hacia arriba. */
export function segundosRestantes(hasta: Date, ahora: Date): number {
  return Math.max(0, Math.ceil((hasta.getTime() - ahora.getTime()) / 1000));
}

/** «45 s», «1 min», «1 min 20 s». */
export function duracionCorta(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m} min` : `${m} min ${r} s`;
}
