/** «hace 3 min», «hace 2 h»… (una lectura fresca se distingue de una vieja de un vistazo). */
export function haceCuanto(iso: string, ahora: number): string {
  const s = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 1000));
  if (s < 45) return "hace unos segundos";
  const min = Math.round(s / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}

/** Hora local («10:32 a.m.»), con el día si no es de hoy. */
export function horaYDia(iso: string, ahora: number): string {
  const fecha = new Date(iso);
  const hora = fecha.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
  const hoy = new Date(ahora);
  return fecha.toDateString() === hoy.toDateString()
    ? hora
    : `${fecha.toLocaleDateString("es-MX", { day: "numeric", month: "short" })}, ${hora}`;
}
