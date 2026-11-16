import type { ReglasParametro } from "../../dominio/catalogo.ts";
import type {
  EntradaEvaluacion,
  Estado,
  Lectura,
  MotivoSensor,
  ResultadoEvaluacion,
} from "./tipos.ts";

type EstadoAgua = Exclude<Estado, "revisar_sensor">;

const GRAVEDAD: Record<EstadoAgua, number> = {
  en_rango: 0,
  atencion: 1,
  fuera_de_rango: 2,
  critico: 3,
};
const POR_GRAVEDAD: EstadoAgua[] = ["en_rango", "atencion", "fuera_de_rango", "critico"];

type Limites = { min: number | null; max: number | null };

/** Positiva: cuánto se pasó del límite. Negativa: cuánto falta para el límite más cercano. */
function distanciaFuera(v: number, n: Limites): number {
  let d = Number.NEGATIVE_INFINITY;
  if (n.min !== null) d = Math.max(d, n.min - v);
  if (n.max !== null) d = Math.max(d, v - n.max);
  return d;
}

/** Cambio frente a la última lectura que tenga al menos `ventana_min` de antigüedad. */
function cambioEn(ventana: Lectura[], i: number, reglas: ReglasParametro): number | null {
  const actual = ventana[i];
  if (!actual) return null;
  const limite = actual.ts.getTime() - reglas.cambio_rapido.ventana_min * 60_000;
  for (let j = i - 1; j >= 0; j--) {
    const ref = ventana[j];
    if (ref && ref.ts.getTime() <= limite) return actual.valor - ref.valor;
  }
  return null;
}

function esRapido(cambio: number | null, reglas: ReglasParametro): boolean {
  return cambio !== null && Math.abs(cambio) > reglas.cambio_rapido.delta;
}

/** Estado de una sola lectura, sin memoria. */
function estadoBruto(d: number, rapido: boolean, r: ReglasParametro): EstadoAgua {
  if (d > r.critico_margen) return "critico";
  if (d > 0) return "fuera_de_rango";
  if (-d <= r.atencion_margen || rapido) return "atencion";
  return "en_rango";
}

/** ¿Sigue justificado permanecer en `estado` aunque ya no lo diga la lectura bruta? (histéresis) */
function sostiene(estado: EstadoAgua, d: number, rapido: boolean, r: ReglasParametro): boolean {
  switch (estado) {
    case "critico":
      return d > r.critico_margen - r.histeresis;
    case "fuera_de_rango":
      return d > -r.histeresis;
    case "atencion":
      return -d <= r.atencion_margen + r.histeresis || rapido;
    default:
      return false;
  }
}

function desviacion(valores: number[]): number {
  const media = valores.reduce((a, b) => a + b, 0) / valores.length;
  const varianza = valores.reduce((a, b) => a + (b - media) ** 2, 0) / valores.length;
  return Math.sqrt(varianza);
}

function motivosDeSensor(e: EntradaEvaluacion, ventana: Lectura[]): MotivoSensor[] {
  const r = e.reglas;
  const motivos: MotivoSensor[] = [];
  const ultimo = ventana[ventana.length - 1]?.valor;
  if (
    ultimo === undefined ||
    !Number.isFinite(ultimo) ||
    ultimo < r.fisico_min ||
    ultimo > r.fisico_max
  ) {
    motivos.push("fuera_fisico");
  }
  const recientes = ventana.slice(-r.lecturas_riel).map((l) => l.valor);
  if (
    recientes.length >= r.lecturas_riel &&
    recientes.every((v) => v <= r.fisico_min + r.riel_margen || v >= r.fisico_max - r.riel_margen)
  ) {
    motivos.push("riel");
  }
  if (r.lecturas_pegadas > 0 && ventana.length >= r.lecturas_pegadas) {
    const cola = ventana.slice(-r.lecturas_pegadas);
    if (cola.every((l) => l.valor === ultimo)) motivos.push("pegado");
  }
  if (
    e.pendientePctNernst !== null &&
    e.pendientePctNernst !== undefined &&
    e.pendientePctNernst < r.sensor_pendiente_min_pct
  ) {
    motivos.push("calibracion");
  }
  if (e.estadoNodo === 3) motivos.push("nodo");
  return motivos;
}

/**
 * Evalúa un parámetro a partir de su ventana reciente. Pura y genérica: todo criterio sale de
 * `reglas` y `norma` (catálogo), nunca del nombre del parámetro.
 */
export function evaluar(e: EntradaEvaluacion): ResultadoEvaluacion {
  if (e.ventana.length === 0) throw new Error("La ventana de evaluación no puede estar vacía");
  const r = e.reglas;
  const ventana = [...e.ventana].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const i = ventana.length - 1;
  const ultima = ventana[i] as Lectura;

  const motivosSensor = motivosDeSensor(e, ventana);
  const cambio = cambioEn(ventana, i, r);
  const cambioRapido = esRapido(cambio, r);

  const k = Math.min(r.lecturas_estable, ventana.length);
  const cola = ventana.slice(-k).map((l) => l.valor);
  const estable =
    ventana.length >= r.lecturas_estable &&
    cola.every(Number.isFinite) &&
    desviacion(cola) <= r.estable_desv_max;

  const base = { valor: ultima.valor, estable, cambio, cambioRapido, motivosSensor };

  if (motivosSensor.length > 0) {
    return { ...base, estado: "revisar_sensor", estable: false, distanciaFuera: Number.NaN };
  }

  const d = distanciaFuera(ultima.valor, e.norma);
  const bruto = estadoBruto(d, cambioRapido, r);
  const previo: EstadoAgua | null = e.previo && e.previo !== "revisar_sensor" ? e.previo : null;

  const resultado = (estado: EstadoAgua): ResultadoEvaluacion => ({
    ...base,
    estado,
    distanciaFuera: d,
  });

  // Primera evaluación (o recuperación del sensor): sin memoria, se toma la lectura tal cual.
  if (previo === null) return resultado(bruto);

  const gPrevio = GRAVEDAD[previo];
  const gBruto = GRAVEDAD[bruto];

  if (gBruto > gPrevio) {
    // Empeora: lo crítico entra de inmediato; lo demás, tras N lecturas consecutivas.
    if (bruto === "critico") return resultado("critico");
    const n = r.lecturas_para_entrar;
    if (ventana.length < n) return resultado(previo);
    let minima = Number.POSITIVE_INFINITY;
    for (let j = ventana.length - n; j < ventana.length; j++) {
      const v = (ventana[j] as Lectura).valor;
      const rap = esRapido(cambioEn(ventana, j, r), r);
      minima = Math.min(minima, GRAVEDAD[estadoBruto(distanciaFuera(v, e.norma), rap, r)]);
    }
    return resultado(minima > gPrevio ? (POR_GRAVEDAD[minima] as EstadoAgua) : previo);
  }

  // Igual o mejora: se baja solo cuando el valor sale con margen de histéresis.
  for (let g = gPrevio; g > gBruto; g--) {
    const candidato = POR_GRAVEDAD[g] as EstadoAgua;
    if (sostiene(candidato, d, cambioRapido, r)) return resultado(candidato);
  }
  return resultado(bruto);
}
