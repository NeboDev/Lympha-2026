import type { Marca } from "./marca.ts";
import { fraccionHOCl } from "./ph.ts";

/**
 * Textos que ve la comunidad (Telegram). Voz de `docs/IDENTIDAD_VISUAL.md` §8: un vecino que sabe,
 * frases cortas, qué pasó + qué significa + qué hacer, sin culpar y sin jerga.
 * REGLA (RNF-32): ningún texto dice «potable» ni «seguro»; lo verifica `frases.test.ts`.
 */

export type ContextoAviso = {
  /** Nombre del nodo, p. ej. «Tinaco azotea». */
  nodo: string;
  /** Nombre legible del parámetro, p. ej. «pH». */
  parametro: string;
  articulo?: "el" | "la";
  valor: number | null;
  decimales: number;
  unidad: string;
  min: number | null;
  max: number | null;
};

const num = (v: number | null, dec: number): string => (v === null ? "—" : v.toFixed(dec));
const medida = (c: ContextoAviso): string =>
  `${num(c.valor, c.decimales)}${c.unidad ? ` ${c.unidad}` : ""}`;
const el = (c: ContextoAviso): string => `${c.articulo === "la" ? "La" : "El"} ${c.parametro}`;
const elMin = (c: ContextoAviso): string => `${c.articulo === "la" ? "la" : "el"} ${c.parametro}`;

/** Los límites se muestran sin ceros de más: 6.5 y no 6.50. */
const limite = (v: number, dec: number): string => String(Number(v.toFixed(dec)));

/** «lo normal va de 6.5 a 8.5», «lo normal es hasta 4», «lo normal es de 6.5 o más». */
function rangoNormal(c: ContextoAviso): string {
  if (c.min !== null && c.max !== null) {
    return `lo normal va de ${limite(c.min, c.decimales)} a ${limite(c.max, c.decimales)}`;
  }
  if (c.max !== null) return `lo normal es hasta ${limite(c.max, c.decimales)}`;
  if (c.min !== null) return `lo normal es de ${limite(c.min, c.decimales)} o más`;
  return "no hay un rango de referencia";
}

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

/** 0 → «menos de 1 minuto» · 18 → «18 minutos» · 65 → «1 hora 5 minutos» · 120 → «2 horas». */
export function duracionLegible(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  if (m < 1) return "menos de 1 minuto";
  if (m < 60) return `${m} ${plural(m, "minuto", "minutos")}`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  const horas = `${h} ${plural(h, "hora", "horas")}`;
  return r === 0 ? horas : `${horas} ${r} ${plural(r, "minuto", "minutos")}`;
}

/** «hace 4 s», «hace 5 minutos», «hace 2 horas». */
export function haceLegible(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} ${plural(m, "minuto", "minutos")}`;
  const h = Math.round(m / 60);
  return `hace ${h} ${plural(h, "hora", "horas")}`;
}

/**
 * Línea sobre la efectividad del cloro libre según el pH (docs/cloracion-ph.md). Devuelve `null` si
 * el cloro todavía actúa bien (≥ `avisoBajoPct` % como HOCl). Es teórica: no mide cloro.
 */
export function lineaCloro(ph: number, tempC: number, avisoBajoPct: number): string | null {
  const pct = fraccionHOCl(ph, tempC) * 100;
  if (pct >= avisoBajoPct) return null;
  return `ℹ️ Con este pH (${ph.toFixed(1)}) el cloro libre actúa con menos fuerza (~${Math.round(pct)} % en su forma más efectiva). Conviene corregir el pH antes de subir la dosis.`;
}

const conCloro = (texto: string, cloro: string | null | undefined) =>
  cloro ? `${texto}\n${cloro}` : texto;

export function avisoFueraDeRango(c: ContextoAviso, cloro?: string | null): string {
  return conCloro(
    [
      `🔶 El agua de «${c.nodo}» salió del rango recomendado.`,
      `${el(c)} está en ${medida(c)} (${rangoNormal(c)}).`,
      "Qué hacer: evita usarla para beber o cocinar hasta revisar. Avísale a la persona responsable.",
    ].join("\n"),
    cloro,
  );
}

export function avisoCritico(
  c: ContextoAviso,
  opciones: { dosificacionDetenida?: boolean; cloro?: string | null } = {},
): string {
  const lineas = [`🟥 ${el(c)} de «${c.nodo}» está muy fuera de rango (${medida(c)}).`];
  if (opciones.dosificacionDetenida) lineas.push("Detuvimos la dosificación.");
  lineas.push("Por favor revisa el tinaco ahora.");
  return conCloro(lineas.join("\n"), opciones.cloro);
}

export function avisoCambioRapido(
  c: ContextoAviso,
  d: { cambio: number | null; ventanaMin: number },
): string {
  const cuanto = d.cambio === null ? "mucho" : Math.abs(d.cambio).toFixed(c.decimales);
  return [
    `🔸 ${el(c)} de «${c.nodo}» cambió ${cuanto} en ${d.ventanaMin} minutos, aunque sigue en rango.`,
    "Puede ser algo que entró al agua. Vale la pena revisar.",
  ].join("\n");
}

export function avisoSensor(c: Pick<ContextoAviso, "nodo">): string {
  return `❔ La lectura de «${c.nodo}» no es confiable (revisar la sonda). No tomes decisiones con este dato hasta calibrar.`;
}

export function avisoSinConexion(d: {
  nodo: string;
  silencioMin: number;
  alarmaLocal?: boolean;
}): string {
  const base = `⚪ No recibimos datos de «${d.nodo}» desde hace ${duracionLegible(d.silencioMin)}.`;
  return d.alarmaLocal ? `${base} La alarma local sigue funcionando.` : base;
}

export type TipoRecordatorio = "nivel" | "cambio_rapido" | "sensor" | "sin_conexion";

/** Recordatorio de una alerta que sigue abierta. */
export function avisoRecordatorio(
  c: ContextoAviso,
  d: { tipo: TipoRecordatorio; duracionMin: number },
): string {
  const lleva = `Lleva ${duracionLegible(d.duracionMin)} activa.`;
  switch (d.tipo) {
    case "sin_conexion":
      return `🔁 Sigue sin llegar información de «${c.nodo}». ${lleva}`;
    case "sensor":
      return `🔁 La lectura de «${c.nodo}» sigue sin ser confiable: falta revisar la sonda. ${lleva}`;
    default:
      return `🔁 Sigue activa la alerta de «${c.nodo}»: ${elMin(c)} está en ${medida(c)} (${rangoNormal(c)}). ${lleva}`;
  }
}

/** Cierre de una alerta: el agua, el sensor o el nodo volvieron a la normalidad. */
export function avisoRecuperacion(
  c: ContextoAviso,
  d: { tipo: TipoRecordatorio; duracionMin: number },
): string {
  const duro = `La alerta duró ${duracionLegible(d.duracionMin)}.`;
  switch (d.tipo) {
    case "sin_conexion":
      return `✅ «${c.nodo}» volvió a enviar datos. ${duro}`;
    case "sensor":
      return `✅ La lectura de «${c.nodo}» volvió a ser confiable. ${duro}`;
    case "cambio_rapido":
      return `✅ ${el(c)} de «${c.nodo}» se estabilizó (${medida(c)}). ${duro}`;
    default:
      return `✅ ${el(c)} de «${c.nodo}» volvió al rango (${medida(c)}). ${duro}`;
  }
}

/* ---- /estado ---- */

export type EstadoLegible =
  | "en_rango"
  | "atencion"
  | "fuera_de_rango"
  | "critico"
  | "revisar_sensor"
  | "sin_conexion";

const ROTULO_ESTADO: Record<EstadoLegible, string> = {
  en_rango: "🟢 En rango",
  atencion: "🟡 Atención",
  fuera_de_rango: "🟠 Fuera de rango",
  critico: "🔴 Crítico",
  revisar_sensor: "⚪ Revisar sensor",
  sin_conexion: "⚪ Sin conexión",
};

export type FilaEstado = {
  nodo: string;
  estado: EstadoLegible | null;
  /** «pH 7.2», o null si no hay lectura. */
  lectura: string | null;
  /** Segundos desde la última muestra. */
  haceS: number | null;
};

export function textoEstado(comunidad: string, filas: FilaEstado[], marca: Marca): string {
  if (filas.length === 0) {
    return `Esta comunidad aún no tiene nodos conectados a ${marca.nombre}.`;
  }
  const lineas = filas.map((f) => {
    if (f.estado === null) return `«${f.nodo}»: todavía no hay lecturas.`;
    const partes = [`«${f.nodo}»: ${ROTULO_ESTADO[f.estado]}`];
    if (f.lectura) partes.push(f.lectura);
    if (f.haceS !== null) partes.push(`lectura ${haceLegible(f.haceS)}`);
    return partes.join(" · ");
  });
  return [
    `💧 Agua de «${comunidad}»`,
    ...lineas,
    "",
    `${marca.nombre} ayuda a vigilar el agua; no la certifica.`,
  ].join("\n");
}

/* ---- Bot ---- */

export function textosBot(marca: Marca) {
  return {
    ayuda: [
      `Soy ${marca.nombre_bot}, el bot de avisos de la calidad del agua de tu comunidad.`,
      "",
      "Comandos:",
      "/estado — cómo está el agua ahora",
      "/ayuda — este mensaje",
      "/desvincular — dejar de recibir avisos (solo quien vinculó el chat)",
      "",
      `Para vincular este chat, abre ${marca.nombre} y toca «Vincular Telegram». ${marca.nombre} no certifica el agua: ayuda a vigilarla y a documentarla.`,
    ].join("\n"),
    vinculado: (comunidad: string) =>
      [
        `✅ Listo: este chat recibirá los avisos de «${comunidad}».`,
        "Te aviso cuando el agua salga del rango, cuando una sonda necesite revisión y cuando un nodo se quede sin datos. Escribe /estado para ver cómo está ahora.",
      ].join("\n"),
    vencido: `Este enlace venció o ya se usó. Genera uno nuevo desde ${marca.nombre}.`,
    ocupado:
      "Este chat ya está vinculado a otra comunidad. Quien lo vinculó puede enviar /desvincular y generar un enlace nuevo.",
    comunidadInexistente: `Esa comunidad ya no existe en ${marca.nombre}. Genera un enlace nuevo.`,
    noVinculado: `Este chat todavía no está vinculado a ninguna comunidad. Abre ${marca.nombre} y toca «Vincular Telegram».`,
    desvinculado:
      "Listo, ya no enviaré avisos a este chat. Puedes vincularlo de nuevo cuando quieras.",
    nadaQueDesvincular: "Este chat no estaba vinculado a ninguna comunidad.",
    soloQuienVinculo:
      "Solo quien vinculó este chat puede desvincularlo. Pídele que envíe /desvincular.",
    errorInterno: "Hubo un problema de nuestro lado. Intenta de nuevo en unos minutos.",
  };
}
