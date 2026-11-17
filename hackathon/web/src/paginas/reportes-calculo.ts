import type { Parametro, Reporte, Serie } from "../api/tipos.ts";
import { valorLegible } from "../util/formato.ts";

export type VistaPrevia = {
  promedio: number | null;
  minimo: number | null;
  maximo: number | null;
  /** Lecturas de los tramos que traen este parámetro. */
  lecturas: number;
};

/**
 * Las cifras clave de un periodo, sacadas de la serie que ya entrega el servidor. Es solo una vista previa:
 * el % en rango y la cobertura los calcula el PDF con todas las lecturas, y por eso no se inventan aquí.
 */
export function vistaPrevia(serie: Serie, parametroId: string): VistaPrevia {
  let suma = 0;
  let lecturas = 0;
  let minimo: number | null = null;
  let maximo: number | null = null;
  for (const p of serie.puntos) {
    const v = p.v[parametroId];
    if (!v) continue;
    suma += v.prom * p.n;
    lecturas += p.n;
    minimo = minimo === null ? v.min : Math.min(minimo, v.min);
    maximo = maximo === null ? v.max : Math.max(maximo, v.max);
  }
  return { promedio: lecturas > 0 ? suma / lecturas : null, minimo, maximo, lecturas };
}

/** Una línea con lo esencial de un reporte anterior: «pH promedio 7.1 (6.4 a 7.9) · 97.2 % en rango · cobertura 94 %». */
export function resumenLinea(r: Reporte, parametros: readonly Parametro[]): string {
  const partes: string[] = [];
  for (const p of parametros) {
    const x = r.resumen.parametros[p.id];
    if (!x || x.n === 0) continue;
    const dec = p.decimales;
    partes.push(
      `${p.nombre} promedio ${valorLegible(x.prom, dec)} (${valorLegible(x.min, dec)} a ${valorLegible(x.max, dec)})`,
    );
    if (x.pct_en_rango !== null) partes.push(`${x.pct_en_rango.toFixed(1)} % en rango`);
  }
  partes.push(`cobertura ${r.resumen.cobertura_pct.toFixed(0)} %`);
  if (r.resumen.alertas > 0)
    partes.push(`${r.resumen.alertas} ${r.resumen.alertas === 1 ? "alerta" : "alertas"}`);
  return partes.join(" · ");
}
