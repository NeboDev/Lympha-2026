import type { Parametro, Serie } from "../api/tipos.ts";
import { valorLegible } from "../util/formato.ts";
import {
  descripcionGrafica,
  dominioY,
  escala,
  marcasX,
  marcasY,
  puntosDe,
  tramos,
} from "./calculo.ts";

const ANCHO = 640;
const ALTO = 240;
const M = { izq: 44, der: 12, arr: 12, abajo: 28 };

/**
 * Gráfica de un parámetro hecha a mano en SVG: la línea del promedio, una banda con el mínimo y el máximo
 * de cada tramo y la franja de la norma. La línea se corta donde el nodo no envió datos (no se interpola).
 * Trae una descripción en texto para quien no ve la imagen.
 */
export function Grafica({ serie, parametro }: { serie: Serie; parametro: Parametro }) {
  const puntos = puntosDe(serie, parametro.id);
  const descripcion = descripcionGrafica(
    parametro.nombre,
    parametro.decimales,
    puntos,
    serie.desde,
    serie.hasta,
  );
  if (puntos.length === 0) {
    return <p className="grafica-vacia">Sin datos de {parametro.nombre} en este periodo.</p>;
  }

  const norma = parametro.norma;
  const [lo, hi] = dominioY(puntos, norma);
  const x = escala(serie.desde.getTime(), serie.hasta.getTime(), M.izq, ANCHO - M.der);
  const y = escala(lo, hi, ALTO - M.abajo, M.arr);
  const pasoMs = serie.paso_s * 1000;
  const lineas = tramos(puntos, pasoMs);
  const hayHuecos = lineas.length > 1;

  const trayecto = (pts: { t: number; v: number }[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");

  const franjaArriba = norma?.max != null ? Math.max(y(norma.max), M.arr) : M.arr;
  const franjaAbajo = norma?.min != null ? Math.min(y(norma.min), ALTO - M.abajo) : ALTO - M.abajo;

  return (
    <figure className="grafica">
      <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} role="img" aria-label={descripcion}>
        {norma && franjaAbajo > franjaArriba && (
          <rect
            x={M.izq}
            y={franjaArriba}
            width={ANCHO - M.izq - M.der}
            height={franjaAbajo - franjaArriba}
            fill="var(--good-soft)"
          />
        )}
        {marcasY(lo, hi).map((v) => (
          <g key={v}>
            <line
              x1={M.izq}
              x2={ANCHO - M.der}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--line)"
              strokeWidth="1"
            />
            <text x={M.izq - 6} y={y(v) + 4} textAnchor="end" className="grafica-eje">
              {valorLegible(v, v % 1 === 0 ? 0 : 1)}
            </text>
          </g>
        ))}
        {[norma?.min, norma?.max].map((lim) =>
          lim == null ? null : (
            <line
              key={lim}
              x1={M.izq}
              x2={ANCHO - M.der}
              y1={y(lim)}
              y2={y(lim)}
              stroke="var(--text-2)"
              strokeWidth="1"
              strokeDasharray="5 4"
            />
          ),
        )}
        {lineas.map((t) => {
          const banda = [
            ...t.map((p) => ({ t: p.t, v: p.max })),
            ...[...t].reverse().map((p) => ({ t: p.t, v: p.min })),
          ];
          return (
            <path
              key={`b${t[0]?.t}`}
              d={`${trayecto(banda)} Z`}
              fill="var(--talavera)"
              opacity="0.14"
            />
          );
        })}
        {lineas.map((t) =>
          t.length === 1 ? (
            <g key={`p${t[0]?.t}`}>
              <line
                x1={x(t[0]?.t ?? 0)}
                x2={x(t[0]?.t ?? 0)}
                y1={y(t[0]?.min ?? 0)}
                y2={y(t[0]?.max ?? 0)}
                stroke="var(--talavera)"
                strokeWidth="3"
                strokeLinecap="round"
                opacity="0.4"
              />
              <circle cx={x(t[0]?.t ?? 0)} cy={y(t[0]?.prom ?? 0)} r="3" fill="var(--talavera)" />
            </g>
          ) : (
            <path
              key={`l${t[0]?.t}`}
              d={trayecto(t.map((p) => ({ t: p.t, v: p.prom })))}
              fill="none"
              stroke="var(--talavera)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ),
        )}
        {marcasX(serie.desde, serie.hasta).map((m, i) => (
          <text
            key={m.t}
            x={x(m.t)}
            y={ALTO - 8}
            textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
            className="grafica-eje"
          >
            {m.texto}
          </text>
        ))}
      </svg>
      <figcaption>
        {descripcion}
        {norma ? " La franja verde es el rango recomendado." : ""}
        {hayHuecos ? " Los tramos sin línea son huecos: el nodo no envió datos." : ""}
      </figcaption>
    </figure>
  );
}
