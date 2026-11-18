/**
 * Corredor de pasos de la prueba de humo (`pnpm smoke`). Es puro: no sabe de Mongo, Blynk ni Telegram;
 * solo ejecuta pasos en orden, mide cuánto tarda cada uno y decide qué hacer cuando uno falla. Así se
 * puede probar sin red.
 */

export type EstadoPaso = "ok" | "fallo" | "omitido";

export type ResultadoPaso = {
  nombre: string;
  estado: EstadoPaso;
  /** Una frase con lo que pasó. Nunca lleva secretos: lo escribe cada paso. */
  detalle: string;
  ms: number;
};

export type PasoHumo = {
  nombre: string;
  /** Devuelve el detalle del resultado (p. ej. «14 muestras»). Si lanza, el paso falla. */
  correr(): Promise<string | undefined>;
  /** Devuelve el motivo si el paso no corresponde en esta corrida; entonces se omite. */
  omitir?: () => string | null;
  /**
   * Los pasos de limpieza se ejecutan SIEMPRE, también después de un fallo: no deben dejar datos de
   * prueba ni el dispositivo en un estado raro.
   */
  siempre?: boolean;
  /** Tiempo máximo del paso. Pasado ese tiempo, falla. */
  esperaMaxMs?: number;
  /** `false`: si este paso falla, los siguientes se siguen intentando (por omisión, se detiene todo). */
  detieneSiFalla?: boolean;
};

export type OpcionesCorredor = {
  ahoraMs?: () => number;
  /** Se llama al terminar cada paso, para mostrar el avance en vivo. */
  alTerminar?: (r: ResultadoPaso) => void;
};

const ESPERA_POR_DEFECTO_MS = 120_000;

function conLimite<T>(promesa: Promise<T>, ms: number): Promise<T> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rechazar) => {
    reloj = setTimeout(
      () => rechazar(new Error(`pasó el tiempo máximo (${Math.round(ms / 1000)} s)`)),
      ms,
    );
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(reloj));
}

/** El mensaje de un error, sin trazas. */
export const mensajeDe = (e: unknown): string =>
  e instanceof Error ? e.message : "error desconocido";

export async function ejecutarPasos(
  pasos: readonly PasoHumo[],
  opciones: OpcionesCorredor = {},
): Promise<ResultadoPaso[]> {
  const ahora = opciones.ahoraMs ?? Date.now;
  const resultados: ResultadoPaso[] = [];
  let detenido = false;

  for (const paso of pasos) {
    const t0 = ahora();
    const registrar = (estado: EstadoPaso, detalle: string) => {
      const r: ResultadoPaso = { nombre: paso.nombre, estado, detalle, ms: ahora() - t0 };
      resultados.push(r);
      opciones.alTerminar?.(r);
    };

    if (detenido && !paso.siempre) {
      registrar("omitido", "no se corrió porque falló un paso anterior");
      continue;
    }
    const motivo = paso.omitir?.() ?? null;
    if (motivo !== null) {
      registrar("omitido", motivo);
      continue;
    }
    try {
      const detalle = await conLimite(paso.correr(), paso.esperaMaxMs ?? ESPERA_POR_DEFECTO_MS);
      registrar("ok", detalle ?? "");
    } catch (e) {
      registrar("fallo", mensajeDe(e));
      if (paso.detieneSiFalla !== false) detenido = true;
    }
  }
  return resultados;
}

/** Las corridas salen con código 0 solo si ningún paso falló. */
export const codigoDeSalida = (r: readonly ResultadoPaso[]): number =>
  r.some((x) => x.estado === "fallo") ? 1 : 0;

const SIMBOLO: Record<EstadoPaso, string> = { ok: "OK   ", fallo: "FALLO", omitido: "omit." };

/** Una línea por paso: «OK    Nombre ........ 1.2 s — detalle». */
export function lineaDe(r: ResultadoPaso, ancho = 38): string {
  const nombre =
    r.nombre.length > ancho ? `${r.nombre.slice(0, ancho - 1)}…` : r.nombre.padEnd(ancho);
  const seg = r.estado === "omitido" ? "" : `${(r.ms / 1000).toFixed(1)} s`.padStart(8);
  const detalle = r.detalle ? `  ${r.detalle}` : "";
  return `${SIMBOLO[r.estado]}  ${nombre}${seg}${detalle}`;
}

export function resumenDe(r: readonly ResultadoPaso[]): string {
  const ok = r.filter((x) => x.estado === "ok").length;
  const fallos = r.filter((x) => x.estado === "fallo").length;
  const omitidos = r.filter((x) => x.estado === "omitido").length;
  const base = `${ok} bien · ${fallos} con fallo · ${omitidos} omitidos`;
  return fallos === 0 ? `Humo: todo en orden (${base}).` : `Humo: HAY FALLOS (${base}).`;
}
