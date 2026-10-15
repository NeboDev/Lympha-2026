import { formatearValor, type Parametro } from "../componentes/parametros.ts";
import { calcularGrafica, type Dimensiones, type Punto } from "./calculo.ts";

const D: Dimensiones = {
  ancho: 600,
  alto: 220,
  margen: { arriba: 12, derecha: 16, abajo: 28, izquierda: 56 },
};

/**
 * Gráfica de línea de un parámetro, sin librería (SVG). Es accesible como imagen con un resumen en texto
 * (mínimo, máximo, último), y debajo se repite como texto visible: la gráfica nunca es la única forma de leer el dato.
 */
export function GraficaLinea({
  titulo,
  puntos,
  parametro,
  formatoX,
}: {
  titulo: string;
  puntos: Punto[];
  parametro: Parametro;
  formatoX: (x: number) => string;
}) {
  const g = calcularGrafica(puntos, D);
  const resumen = g.resumen
    ? `Mínimo ${formatearValor(parametro, g.resumen.minimo)}, máximo ${formatearValor(parametro, g.resumen.maximo)}, último ${formatearValor(parametro, g.resumen.ultimo)} (${g.resumen.n} datos).`
    : "Sin datos en este periodo.";

  return (
    <figure className="grafica">
      <figcaption>{titulo}</figcaption>
      {g.resumen ? (
        <svg
          viewBox={`0 0 ${D.ancho} ${D.alto}`}
          role="img"
          aria-label={`${titulo}. ${resumen}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {g.ticksY.map((t) => (
            <g key={t.valor}>
              <line
                x1={D.margen.izquierda}
                x2={D.ancho - D.margen.derecha}
                y1={t.y}
                y2={t.y}
                className="eje"
              />
              <text x={D.margen.izquierda - 6} y={t.y + 4} textAnchor="end" className="etiqueta">
                {formatearValor({ ...parametro, unidad: "" }, t.valor)}
              </text>
            </g>
          ))}
          {g.ticksX.map((t, i) => (
            <text
              key={t.valor}
              x={t.x}
              y={D.alto - 8}
              textAnchor={i === 0 ? "start" : i === g.ticksX.length - 1 ? "end" : "middle"}
              className="etiqueta"
            >
              {formatoX(t.valor)}
            </text>
          ))}
          {g.trazos.map((d) => (
            <path key={d} d={d} className="linea" />
          ))}
          {g.aislados.map((p) => (
            <circle key={`${p.cx}-${p.cy}`} cx={p.cx} cy={p.cy} r={3} className="punto" />
          ))}
        </svg>
      ) : null}
      <p className="detalle">
        {resumen}
        {parametro.unidad && g.resumen ? ` Unidad: ${parametro.unidad}.` : ""}
      </p>
    </figure>
  );
}
