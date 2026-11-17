import { DEGRADADO_PH, posicionPh } from "../util/ph.ts";

/**
 * Indicador de pH tipo papel indicador: un degradado de ácido a básico, la zona de la norma marcada y un
 * punto donde está la lectura. La lectura también va escrita (no depende del color).
 */
export function EscalaPh({
  valor,
  min,
  max,
}: {
  valor: number | null;
  /** Límites de la norma a marcar; `null` si no hay. */
  min: number | null;
  max: number | null;
}) {
  const zonaIzq = min === null ? 0 : posicionPh(min);
  const zonaDer = max === null ? 100 : posicionPh(max);
  return (
    <div className="escala-ph" aria-hidden="true">
      <div
        className="escala-barra"
        style={{ background: `linear-gradient(90deg, ${DEGRADADO_PH})` }}
      >
        <div
          className="escala-zona"
          style={{ left: `${zonaIzq}%`, width: `${Math.max(0, zonaDer - zonaIzq)}%` }}
        />
        {valor !== null && (
          <div className="escala-punto" style={{ left: `${posicionPh(valor)}%` }} />
        )}
      </div>
      <div className="escala-numeros">
        <span>0</span>
        <span>7</span>
        <span>14</span>
      </div>
    </div>
  );
}
