import { formatearValor, PARAMETROS } from "../componentes/parametros.ts";
import { etiquetaNivel, simboloNivel } from "../componentes/TarjetaNodo.tsx";
import { type CeldaDia, etiquetaDia, numeroDia } from "./dias.ts";

const NIVELES_ORDEN = ["buena", "regular", "mala", "critica", "sin_datos"] as const;

/**
 * Nivel predominante por día (RF-35). Cada día es un botón con color Y texto («14, Regular»): el color solo
 * nunca dice el nivel. Un día sin ningún registro se muestra vacío y se dice «sin registro».
 */
export function TiraDias({
  celdas,
  elegido,
  alElegir,
}: {
  celdas: CeldaDia[];
  elegido: string | null;
  alElegir: (dia: string) => void;
}) {
  return (
    <div className="tira" role="group" aria-label="Nivel predominante por día">
      {celdas.map((c) => {
        const nivel = c.datos?.nivel ?? null;
        const texto = nivel ? etiquetaNivel(nivel) : "Sin registro";
        return (
          <button
            key={c.dia}
            type="button"
            className={`dia ${nivel ? `nivel-${nivel}` : "vacio"} ${elegido === c.dia ? "elegido" : ""}`}
            aria-pressed={elegido === c.dia}
            aria-label={`${etiquetaDia(c.dia)}: ${texto}`}
            onClick={() => alElegir(c.dia)}
          >
            <span className="numero">{numeroDia(c.dia)}</span>
            <span className="nivel" aria-hidden="true">
              {nivel ? simboloNivel(nivel) : "—"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Lo que pasó el día elegido: nivel predominante, reparto de evaluaciones, WQI y promedios por parámetro. */
export function PanelDia({ celda }: { celda: CeldaDia }) {
  const d = celda.datos;
  if (!d) {
    return (
      <div className="panel-dia">
        <h3>{etiquetaDia(celda.dia)}</h3>
        <p>Sin registro: el nodo no mandó datos ese día.</p>
      </div>
    );
  }
  const total = NIVELES_ORDEN.reduce((s, n) => s + d.evaluaciones[n], 0);
  return (
    <div className="panel-dia">
      <h3>{etiquetaDia(celda.dia)}</h3>
      <p>
        Nivel predominante: <strong>{etiquetaNivel(d.nivel)}</strong>
      </p>
      <p className="detalle">
        De {total} evaluaciones:{" "}
        {NIVELES_ORDEN.filter((n) => d.evaluaciones[n] > 0)
          .map((n) => `${d.evaluaciones[n]} ${etiquetaNivel(n).toLowerCase()}`)
          .join(", ") || "ninguna"}
        .
      </p>
      {d.wqi_prom !== null && (
        <p className="detalle">
          Índice de calidad: promedio {Math.round(d.wqi_prom)}
          {d.wqi_min !== null ? `, mínimo ${Math.round(d.wqi_min)}` : ""} (de 0 a 100).
        </p>
      )}
      {d.promedios && (
        <dl className="valores">
          {PARAMETROS.map((p) => (
            <div key={p.clave}>
              <dt>{p.nombre}</dt>
              <dd>{formatearValor(p, d.promedios?.[p.clave])}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
