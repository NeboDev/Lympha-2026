import { createTheme, ThemeProvider } from "@mui/material/styles";
import {
  axisClasses,
  ChartsReferenceLine,
  LineChart,
  useDrawingArea,
  useYScale,
} from "@mui/x-charts";
import { lineClasses } from "@mui/x-charts/LineChart";
import type { Parametro, Serie } from "../api/tipos.ts";
import { valorLegible } from "../util/formato.ts";
import { datosParaLinea, descripcionGrafica, dominioY, puntosDe, tramos } from "./calculo.ts";
import { formatoEjeX } from "./ejes.ts";

/** El tema de MUI sigue al del sistema (claro u oscuro) y usa la tipografía de la app. */
const TEMA = createTheme({
  colorSchemes: { light: true, dark: true },
  typography: { fontFamily: "var(--font-sans)" },
});

/** La franja de la norma (por ejemplo pH 6.5 a 8.5), dibujada con el tono «en rango». */
function FranjaNorma({ min, max }: { min: number | null; max: number | null }) {
  const area = useDrawingArea();
  const escalaY = useYScale<"linear">();
  const [d0, d1] = escalaY.domain() as [number, number];
  const arriba = escalaY(Math.min(max ?? d1, d1));
  const abajo = escalaY(Math.max(min ?? d0, d0));
  if (!(abajo > arriba)) return null;
  return (
    <rect
      x={area.left}
      y={arriba}
      width={area.width}
      height={abajo - arriba}
      fill="var(--good)"
      fillOpacity={0.16}
      pointerEvents="none"
    />
  );
}

/**
 * Gráfica de un parámetro con MUI X Charts: la línea del promedio, el mínimo y el máximo de cada tramo y la franja
 * de la norma. La línea se corta donde el nodo no envió datos (no se interpola). Trae una descripción en texto
 * para quien no ve la imagen.
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
  const pasoMs = serie.paso_s * 1000;
  const datos = datosParaLinea(puntos, pasoMs);
  const hayHuecos = tramos(puntos, pasoMs).length > 1;
  const formato = (v: number | null) => (v == null ? "" : valorLegible(v, parametro.decimales));
  // Un punto aislado (sin vecinos) no formaría línea: se marca para que se vea.
  const aislado = (i: number) => datos.prom[i - 1] == null && datos.prom[i + 1] == null;

  return (
    <figure className="grafica">
      <ThemeProvider theme={TEMA}>
        <LineChart
          height={260}
          margin={{ top: 12, right: 16, bottom: 8, left: 4 }}
          hideLegend
          skipAnimation
          grid={{ horizontal: true }}
          xAxis={[
            {
              data: datos.t,
              scaleType: "time",
              min: serie.desde,
              max: serie.hasta,
              tickNumber: 4,
              valueFormatter: (d: Date, contexto) =>
                formatoEjeX(d, serie.desde, serie.hasta, contexto.location === "tooltip"),
            },
          ]}
          yAxis={[{ min: lo, max: hi, width: 44 }]}
          series={[
            {
              id: "max",
              label: "Máximo",
              data: datos.max,
              color: "var(--line-strong)",
              curve: "linear",
              showMark: false,
              valueFormatter: formato,
            },
            {
              id: "min",
              label: "Mínimo",
              data: datos.min,
              color: "var(--line-strong)",
              curve: "linear",
              showMark: false,
              valueFormatter: formato,
            },
            {
              id: "prom",
              label: parametro.nombre,
              data: datos.prom,
              color: "var(--brand)",
              curve: "linear",
              showMark: ({ index }: { index: number }) => aislado(index),
              valueFormatter: formato,
            },
          ]}
          sx={{
            [`& .${axisClasses.tickLabel}`]: {
              fill: "var(--text-2)",
              fontVariantNumeric: "tabular-nums",
            },
            [`& .${axisClasses.line}, & .${axisClasses.tick}`]: { stroke: "var(--line-strong)" },
            "& .MuiChartsGrid-line": { stroke: "var(--line)" },
            [`& .${lineClasses.line}`]: { strokeWidth: 2 },
          }}
        >
          {norma && <FranjaNorma min={norma.min} max={norma.max} />}
          {[norma?.min, norma?.max].map((lim) =>
            lim == null ? null : (
              <ChartsReferenceLine
                key={lim}
                y={lim}
                lineStyle={{ stroke: "var(--text-2)", strokeDasharray: "5 4", strokeWidth: 1 }}
              />
            ),
          )}
        </LineChart>
      </ThemeProvider>
      <figcaption>
        {descripcion}
        {norma ? " La franja verde es el rango recomendado." : ""}
        {hayHuecos ? " Los tramos sin línea son huecos: el nodo no envió datos." : ""}
      </figcaption>
    </figure>
  );
}
