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

/* ---- Reporte (PDF) ----
 * El PDF usa fuentes estándar (WinAnsi): sin emoji ni símbolos como ✓ o ≥. Todo texto del reporte
 * pasa por aquí para que `frases.test.ts` verifique que no dice «potable», «seguro» ni «cumple».
 */

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** «16 nov 2026, 14:05» en hora de México; con `conHora = false`, solo «16 nov 2026». */
export function fechaMx(d: Date, conHora = true): string {
  const partes = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const p = (tipo: string) => partes.find((x) => x.type === tipo)?.value ?? "";
  const dia = `${p("day")} ${MESES[Number(p("month")) - 1] ?? ""} ${p("year")}`;
  return conHora ? `${dia}, ${p("hour")}:${p("minute")}` : dia;
}

export function periodoLegible(desde: Date, hasta: Date): string {
  return `${fechaMx(desde)} a ${fechaMx(hasta)} (hora de México)`;
}

/** «6.5 a 8.5», «hasta 4», «0.2 o más»; null si no hay límites. */
export function rangoNorma(min: number | null, max: number | null, dec: number): string | null {
  if (min !== null && max !== null) return `${limite(min, dec)} a ${limite(max, dec)}`;
  if (max !== null) return `hasta ${limite(max, dec)}`;
  if (min !== null) return `${limite(min, dec)} o más`;
  return null;
}

export type NivelInsignia = "bien" | "atencion" | "fuera" | "sin_datos";
export type Insignia = { nivel: NivelInsignia; rotulo: string; texto: string };

export type FuenteInsignia = {
  nombre: string;
  articulo?: "el" | "la";
  /** % del tiempo con datos que el parámetro estuvo dentro del rango; null si no hubo muestras. */
  pctEnRango: number | null;
  coberturaPct: number;
  norma: {
    min: number | null;
    max: number | null;
    decimales: number;
    /** Complemento de «del rango …»: «de la NOM-127» o «configurado para este nodo». */
    origen: string;
  };
  coberturaMinPct: number;
  bienPct: number;
  atencionPct: number;
};

const ROTULO_INSIGNIA: Record<NivelInsignia, string> = {
  bien: "En rango",
  atencion: "Atención",
  fuera: "Fuera de rango",
  sin_datos: "Datos insuficientes",
};

/**
 * La insignia de un parámetro: «pH dentro del rango de la NOM-127 el 97.2 % del tiempo». Nunca un
 * «cumple» global. Con poca cobertura no se da un porcentaje que parezca describir todo el periodo.
 */
export function insigniaParametro(f: FuenteInsignia): Insignia {
  const sujeto = `${f.articulo === "la" ? "La" : "El"} ${f.nombre}`;
  if (f.pctEnRango === null || f.coberturaPct < f.coberturaMinPct) {
    return {
      nivel: "sin_datos",
      rotulo: ROTULO_INSIGNIA.sin_datos,
      texto: `${sujeto}: no hay datos suficientes para describir el periodo (se recibieron datos el ${f.coberturaPct.toFixed(0)} % del tiempo).`,
    };
  }
  const nivel: NivelInsignia =
    f.pctEnRango >= f.bienPct ? "bien" : f.pctEnRango >= f.atencionPct ? "atencion" : "fuera";
  const rango = rangoNorma(f.norma.min, f.norma.max, f.norma.decimales);
  const donde = rango ? `del rango ${f.norma.origen} (${rango})` : `del rango ${f.norma.origen}`;
  const texto =
    nivel === "fuera"
      ? `${sujeto} estuvo dentro ${donde} solo el ${f.pctEnRango.toFixed(1)} % del tiempo con datos.`
      : `${sujeto} estuvo dentro ${donde} el ${f.pctEnRango.toFixed(1)} % del tiempo con datos.`;
  return { nivel, rotulo: ROTULO_INSIGNIA[nivel], texto };
}

export type FuenteResumen = {
  comunidad: string;
  nodo: string;
  desde: Date;
  hasta: Date;
  /** Parámetros que el nodo midió, con su género. */
  medidos: { nombre: string; articulo?: "el" | "la" }[];
  alertas: { total: number; masGrave: "atencion" | "alta" | "critica" | null };
  coberturaPct: number;
  coberturaMinPct: number;
  huecos: number;
  huecoMayorS: number | null;
};

const SEVERIDAD_LEGIBLE = { atencion: "atención", alta: "alta", critica: "crítica" } as const;

/** Resumen en lenguaje sencillo: qué se midió, cuánto del tiempo en rango, qué pasó. 3 a 5 líneas. */
export function resumenReporte(f: FuenteResumen): string[] {
  const lineas: string[] = [];
  const medidos = f.medidos.map((m) => m.nombre).join(", ");
  lineas.push(
    `Del ${fechaMx(f.desde, false)} al ${fechaMx(f.hasta, false)}, el nodo «${f.nodo}» de «${f.comunidad}» midió: ${medidos || "nada (todavía no hay parámetros configurados)"}.`,
  );
  lineas.push(
    f.alertas.total === 0
      ? "No hubo alertas en este periodo."
      : `Hubo ${f.alertas.total} ${plural(f.alertas.total, "alerta", "alertas")}${f.alertas.masGrave ? ` (la más grave fue de severidad ${SEVERIDAD_LEGIBLE[f.alertas.masGrave]})` : ""}.`,
  );
  let datos = `Se recibieron datos durante el ${f.coberturaPct.toFixed(0)} % del periodo`;
  if (f.huecos > 0) {
    const mayor =
      f.huecoMayorS === null ? "" : `, el más largo de ${duracionLegible(f.huecoMayorS / 60)}`;
    datos += `, con ${f.huecos} ${plural(f.huecos, "hueco", "huecos")} sin datos${mayor}`;
  }
  datos += ".";
  if (f.coberturaPct < f.coberturaMinPct) {
    datos += " Con tan pocos datos, las cifras no describen todo el periodo.";
  }
  lineas.push(datos);
  return lineas;
}

export const TITULO_REPORTE = "Bitácora de calidad del agua";

export const AVISO_NO_CUBRE = [
  "Un sensor no sustituye el muestreo ni el análisis de laboratorio.",
  "La NOM-127 exige más parámetros de los que este nodo mide (por ejemplo, los microbiológicos); este reporte no los cubre.",
];

export const TEXTO_NO_MEDIDOS = "Parámetros de la NOM-127 que este nodo no midió en este periodo:";
export const TEXTO_SIN_REGISTROS = "Sin registros en este periodo.";
export const TEXTO_SIN_DATOS_GRAFICA = "Sin datos en este periodo.";
export const TEXTO_HUECOS_GRAFICA = "Los tramos sin línea son huecos: el nodo no envió datos.";

export function pieReporte(f: { marca: string; id: string; hash: string; generado: Date }): string {
  return `${f.marca} · no es una certificación · Reporte ${f.id} · huella ${f.hash} · generado ${fechaMx(f.generado)}`;
}

const TITULO_NIVEL: Record<string, string> = {
  critica: "crítico",
  alta: "fuera de rango",
  atencion: "en atención",
};

export type FuenteAlerta = {
  tipo: "nivel" | "cambio_rapido" | "sensor" | "sin_conexion";
  severidadMaxima: "atencion" | "alta" | "critica";
  /** Nombre legible del parámetro, o null para alertas del nodo completo. */
  parametro: string | null;
  abierta: Date;
  cerrada: Date | null;
  valorApertura: number | null;
  decimales: number;
  /** Fin del periodo del reporte: para medir cuánto lleva abierta una alerta que sigue abierta. */
  hasta: Date;
};

export function tituloAlerta(
  a: Pick<FuenteAlerta, "tipo" | "severidadMaxima" | "parametro">,
): string {
  const p = a.parametro ?? "parámetro";
  switch (a.tipo) {
    case "nivel":
      return `${p} ${TITULO_NIVEL[a.severidadMaxima] ?? "fuera de rango"}`;
    case "cambio_rapido":
      return `Cambio rápido de ${p}`;
    case "sensor":
      return `Revisar sensor de ${p}`;
    case "sin_conexion":
      return "Nodo sin conexión";
  }
}

export function detalleAlerta(a: FuenteAlerta): string {
  const fin = a.cerrada ?? a.hasta;
  const minutos = Math.max(0, (fin.getTime() - a.abierta.getTime()) / 60_000);
  const partes = [
    a.cerrada ? `Duró ${duracionLegible(minutos)}` : `Seguía abierta (${duracionLegible(minutos)})`,
  ];
  if (a.valorApertura !== null)
    partes.push(`valor al abrir ${a.valorApertura.toFixed(a.decimales)}`);
  return partes.join(" · ");
}

export const TITULO_EVENTO: Record<string, string> = {
  sin_datos: "Nodo sin datos",
  reconexion: "Nodo volvió a enviar datos",
  actuador: "Acción del actuador",
};

export const DIAGNOSTICO_CALIBRACION: Record<string, string> = {
  buena: "Buena",
  desgastada: "Desgastada",
  revisar: "Revisar",
};

/* ---- Bot ---- */

export type ReglasDiasReporte = { dias_defecto: number; dias_max: number };

export function textosBot(
  marca: Marca,
  reporte: ReglasDiasReporte = { dias_defecto: 7, dias_max: 90 },
) {
  return {
    reporteEnCurso: (dias: number) =>
      `Preparando el reporte de los últimos ${dias} ${plural(dias, "día", "días")}…`,
    reporteLeyenda: (nodo: string, dias: number) =>
      `Reporte de «${nodo}» · últimos ${dias} ${plural(dias, "día", "días")}. ${marca.nombre} no certifica el agua: es la bitácora de lo que midió el nodo.`,
    reporteDiasInvalidos: `Pídeme un periodo de 1 a ${reporte.dias_max} días, por ejemplo: /reporte ${reporte.dias_defecto}`,
    reporteNoDisponible: "El reporte no está disponible por ahora.",
    reporteOcupado: "Ya estoy preparando un reporte para este chat. Espera un momento.",
    reporteSinNodos: `Esta comunidad aún no tiene nodos conectados a ${marca.nombre}.`,
    ayuda: [
      `Soy ${marca.nombre_bot}, el bot de avisos de la calidad del agua de tu comunidad.`,
      "",
      "Comandos:",
      "/estado — cómo está el agua ahora",
      `/reporte [días] — reporte en PDF (por defecto, ${reporte.dias_defecto} días)`,
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
