import type { Catalogo } from "../../dominio/catalogo.ts";
import {
  DIAGNOSTICO_CALIBRACION,
  detalleAlerta,
  type Insignia,
  insigniaParametro,
  rangoNorma,
  resumenReporte,
  TITULO_EVENTO,
  tituloAlerta,
} from "../../dominio/frases.ts";
import type { AlertaDoc } from "../alertas/index.ts";
import type { NodoDoc } from "../nodos/index.ts";
import { type EstadisticaParametro, estadisticasParametro, serieGrafica } from "./estadisticas.ts";
import type { CalibracionDoc, EventoReporte, MuestraReporte } from "./puertos.ts";

/** Todo lo que el PDF dibuja, ya calculado y redactado. Sin I/O: se puede probar sin red ni base. */

export type NormaReporte = {
  min: number | null;
  max: number | null;
  /** «6.5 a 8.5», «hasta 4»…; null si no hay límites. */
  texto: string | null;
  /** Complemento de «del rango …»: «de la NOM-127» o «configurado para este nodo». */
  origen: string;
  /** Los límites marcados «verificar» en el catálogo se muestran como pendientes de confirmar. */
  porVerificar: boolean;
};

export type ParametroReporte = {
  id: string;
  nombre: string;
  articulo: "el" | "la";
  unidad: string;
  decimales: number;
  norma: NormaReporte | null;
  estadisticas: EstadisticaParametro;
  insignia: Insignia | null;
  /** Promedio por tramo; null = hueco. */
  serie: (number | null)[];
};

export type FilaEvento = { ts: Date; titulo: string; detalle: string };
export type FilaCalibracion = {
  ts: Date;
  parametro: string;
  pendiente: string;
  offset: string;
  diagnostico: string;
};
export type FilaBitacora = { ts: Date; texto: string };

export type ContenidoReporte = {
  marca: string;
  comunidad: string;
  nodo: { id: string; nombre: string; ubicacion: string | null };
  desde: Date;
  hasta: Date;
  resumen: string[];
  parametros: ParametroReporte[];
  noMedidos: { nombre: string; unidad: string }[];
  eventos: FilaEvento[];
  calibraciones: FilaCalibracion[];
  bitacora: FilaBitacora[];
  alertasTotal: number;
  coberturaPct: number;
};

export type EntradaContenido = {
  marca: string;
  comunidad: string;
  nodo: NodoDoc;
  desde: Date;
  hasta: Date;
  muestras: readonly MuestraReporte[];
  alertas: readonly AlertaDoc[];
  eventos: readonly EventoReporte[];
  calibraciones: readonly CalibracionDoc[];
  catalogo: Catalogo;
};

const GRAVEDAD = { atencion: 0, alta: 1, critica: 2 } as const;

/** «NOM-127-SSA1-2021» → «NOM-127». */
const fuenteCorta = (fuente: string): string => fuente.split("-").slice(0, 2).join("-");

export function construirContenido(e: EntradaContenido): ContenidoReporte {
  const { catalogo, nodo, desde, hasta } = e;
  const reglas = catalogo.reporte;

  const parametros: ParametroReporte[] = nodo.parametros.flatMap((id) => {
    const p = catalogo.parametros[id];
    if (!p?.medible) return [];
    const umbral = nodo.umbrales?.[id];
    const limites = umbral ?? (p.norma ? { min: p.norma.min, max: p.norma.max } : null);
    const norma: NormaReporte | null = limites
      ? {
          min: limites.min,
          max: limites.max,
          texto: rangoNorma(limites.min, limites.max, p.decimales),
          origen: umbral
            ? "configurado para este nodo"
            : `de la ${p.norma ? fuenteCorta(p.norma.fuente) : "norma"}`,
          porVerificar: !umbral && p.norma?.estado === "verificar",
        }
      : null;
    const estadisticas = estadisticasParametro(
      e.muestras,
      id,
      limites,
      desde,
      hasta,
      reglas.hueco_max_s,
    );
    const articulo = p.articulo ?? "el";
    const insignia =
      norma && norma.texto !== null && !norma.porVerificar
        ? insigniaParametro({
            nombre: p.nombre,
            articulo,
            pctEnRango: estadisticas.pctEnRango,
            coberturaPct: estadisticas.coberturaPct,
            norma: { min: norma.min, max: norma.max, decimales: p.decimales, origen: norma.origen },
            coberturaMinPct: reglas.cobertura_min_pct,
            bienPct: reglas.insignia.bien_pct,
            atencionPct: reglas.insignia.atencion_pct,
          })
        : null;
    return [
      {
        id,
        nombre: p.nombre,
        articulo,
        unidad: p.unidad,
        decimales: p.decimales,
        norma,
        estadisticas,
        insignia,
        serie: serieGrafica(e.muestras, id, desde, hasta, reglas.grafica_puntos),
      },
    ];
  });

  const medidos = new Set(parametros.map((p) => p.id));
  const noMedidos = Object.entries(catalogo.parametros)
    .filter(([id, p]) => p.norma !== null && !medidos.has(id))
    .map(([, p]) => ({ nombre: p.nombre, unidad: p.unidad }));

  const nombreDe = (id: string | null): string | null =>
    id === null ? null : (catalogo.parametros[id]?.nombre ?? id);
  const decimalesDe = (id: string | null): number =>
    id === null ? 2 : (catalogo.parametros[id]?.decimales ?? 2);

  const filas: FilaEvento[] = [
    ...e.alertas.map((a) => ({
      ts: a.abierta,
      titulo: tituloAlerta({
        tipo: a.tipo,
        severidadMaxima: a.severidad_maxima,
        parametro: nombreDe(a.parametro),
      }),
      detalle: detalleAlerta({
        tipo: a.tipo,
        severidadMaxima: a.severidad_maxima,
        parametro: nombreDe(a.parametro),
        abierta: a.abierta,
        cerrada: a.cerrada,
        valorApertura: a.valor_apertura,
        decimales: decimalesDe(a.parametro),
        hasta,
      }),
    })),
    ...e.eventos
      .filter((v) => v.tipo !== "bitacora")
      .map((v) => ({ ts: v.ts, titulo: TITULO_EVENTO[v.tipo] ?? v.tipo, detalle: v.mensaje })),
  ].sort((a, b) => a.ts.getTime() - b.ts.getTime());

  const calibraciones: FilaCalibracion[] = e.calibraciones.map((c) => ({
    ts: c.ts,
    // Las que reportó la placa (no una persona con buffers) se rotulan, para que la trazabilidad no engañe.
    parametro: `${nombreDe(c.parametro) ?? c.parametro}${c.origen === "nodo" ? " (del nodo)" : ""}`,
    pendiente:
      c.pendiente_pct_nernst === null ? "—" : `${c.pendiente_pct_nernst.toFixed(1)} % de Nernst`,
    offset: c.offset_mv === null ? "—" : `${c.offset_mv.toFixed(1)} mV`,
    diagnostico: c.diagnostico ? (DIAGNOSTICO_CALIBRACION[c.diagnostico] ?? c.diagnostico) : "—",
  }));

  const bitacora: FilaBitacora[] = e.eventos
    .filter((v) => v.tipo === "bitacora")
    .map((v) => ({ ts: v.ts, texto: v.mensaje }));

  // Cobertura y huecos del nodo: los del parámetro con más datos (con varios, el nodo envía todo junto).
  const principal = parametros.reduce<EstadisticaParametro | null>(
    (mejor, p) =>
      !mejor || p.estadisticas.coberturaPct > mejor.coberturaPct ? p.estadisticas : mejor,
    null,
  );
  const coberturaPct = principal?.coberturaPct ?? 0;
  const masGrave = e.alertas.reduce<"atencion" | "alta" | "critica" | null>(
    (g, a) => (g === null || GRAVEDAD[a.severidad_maxima] > GRAVEDAD[g] ? a.severidad_maxima : g),
    null,
  );

  const resumen = resumenReporte({
    comunidad: e.comunidad,
    nodo: nodo.nombre,
    desde,
    hasta,
    medidos: parametros.map((p) => ({ nombre: p.nombre, articulo: p.articulo })),
    alertas: { total: e.alertas.length, masGrave },
    coberturaPct,
    coberturaMinPct: reglas.cobertura_min_pct,
    huecos: principal?.huecos ?? 0,
    huecoMayorS: principal?.huecoMayorS ?? null,
  });

  return {
    marca: e.marca,
    comunidad: e.comunidad,
    nodo: {
      id: nodo._id.toHexString(),
      nombre: nodo.nombre,
      ubicacion: nodo.ubicacion?.texto ?? null,
    },
    desde,
    hasta,
    resumen,
    parametros,
    noMedidos,
    eventos: filas,
    calibraciones,
    bitacora,
    alertasTotal: e.alertas.length,
    coberturaPct,
  };
}
