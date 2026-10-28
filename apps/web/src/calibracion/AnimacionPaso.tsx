import type { ParametroCalibrable } from "@lympha/calibracion";
import type { CSSProperties } from "react";
import "./animacion.css";
import { type TipoSolucion, tipoSolucion } from "./utilidades.ts";

const COLOR: Record<TipoSolucion, string> = {
  ph4: "var(--cal-ph4)",
  ph7: "var(--cal-ph7)",
  ph10: "var(--cal-ph10)",
  destilada: "var(--cal-destilada)",
  conductividad: "var(--cal-conductividad)",
  turbidez: "var(--cal-turbidez)",
};

const NOMBRE: Record<TipoSolucion, string> = {
  ph4: "solución buffer de pH 4",
  ph7: "solución buffer de pH 7",
  ph10: "solución buffer de pH 10",
  destilada: "agua destilada",
  conductividad: "solución patrón de conductividad",
  turbidez: "patrón de turbidez",
};

const CIRCUNFERENCIA = 2 * Math.PI * 20;
// posiciones fijas para que las partículas no cambien entre renders
const PARTICULAS = [
  [88, 128],
  [104, 142],
  [120, 124],
  [136, 140],
  [96, 150],
  [128, 152],
  [112, 134],
  [144, 126],
];

/**
 * Ilustración del paso: un vaso con la solución patrón (del color real del patrón) y la sonda. Mientras se prepara,
 * la sonda flota arriba y se enjuaga; al medir baja a la solución, hay ondas en la superficie y un aro que se llena
 * con las lecturas reunidas hasta mostrar una palomita cuando la lectura es estable. Es solo apoyo visual: el
 * estado se dice también con texto, y con «reducir movimiento» queda todo quieto.
 */
export function AnimacionPaso({
  parametro,
  referencia,
  midiendo,
  progreso,
  estable,
}: {
  parametro: ParametroCalibrable;
  referencia: number;
  midiendo: boolean;
  /** 0 a 1: lecturas reunidas / necesarias. */
  progreso: number;
  estable: boolean;
}) {
  const tipo = tipoSolucion(parametro, referencia);
  const llenado = Math.min(1, Math.max(0, progreso));
  const clases = ["cal-anim", midiendo ? "cal-medir" : "", estable ? "cal-estable" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <svg
      viewBox="0 0 260 190"
      className={clases}
      style={{ "--liquido": COLOR[tipo] } as CSSProperties}
      role="img"
      aria-label={
        midiendo
          ? `Sonda dentro de la ${NOMBRE[tipo]}, midiendo`
          : `Sonda fuera de la ${NOMBRE[tipo]}, lista para enjuagar y meter`
      }
    >
      <defs>
        <clipPath id="cal-interior">
          <path d="M66 96 H154 L150 166 Q150 172 144 172 H76 Q70 172 70 166 Z" />
        </clipPath>
      </defs>

      {/* sonda (detrás del líquido, para que la punta se vea sumergida) */}
      <g className="cal-sonda">
        <path className="cal-sonda-cable" d="M110 -10 V8" />
        <rect className="cal-sonda-cuerpo" x="102" y="8" width="16" height="92" rx="5" />
        <rect className="cal-sonda-punta" x="105" y="100" width="10" height="34" rx="5" />
        <circle className="cal-gota" cx="100" cy="142" r="3" />
        <circle className="cal-gota" cx="112" cy="140" r="3" />
        <circle className="cal-gota" cx="122" cy="142" r="3" />
      </g>

      {/* solución */}
      <g clipPath="url(#cal-interior)">
        <g className="cal-onda">
          <path
            className="cal-liquido"
            d="M30 100 q10 -6 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 V180 H30 Z"
          />
        </g>
        {tipo === "turbidez" &&
          PARTICULAS.map(([x, y]) => (
            <circle key={`${x}-${y}`} className="cal-particula" cx={x} cy={y} r="2.4" />
          ))}
      </g>

      {/* ondas donde la sonda toca la superficie */}
      <ellipse className="cal-onda-anillo" cx="110" cy="100" rx="22" ry="5" />
      <ellipse className="cal-onda-anillo" cx="110" cy="100" rx="22" ry="5" />

      {/* vaso */}
      <path
        className="cal-vidrio"
        d="M62 84 L66 166 Q66 176 76 176 H144 Q154 176 154 166 L158 84"
      />
      <path className="cal-vidrio" d="M58 84 H162" />

      {/* avance de la estabilización */}
      <circle className="cal-aro-fondo" cx="232" cy="34" r="24" />
      {midiendo && (
        <circle
          className="cal-aro"
          cx="232"
          cy="34"
          r="20"
          strokeDasharray={CIRCUNFERENCIA}
          strokeDashoffset={CIRCUNFERENCIA * (1 - llenado)}
        />
      )}
      <path className="cal-palomita" d="M222 35 l7 7 l13 -14" />
    </svg>
  );
}
