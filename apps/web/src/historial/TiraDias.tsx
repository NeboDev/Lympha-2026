import { ICONO_ESTADO } from "../componentes/estados.tsx";
import { formatearValor, PARAMETROS } from "../componentes/parametros.ts";
import { etiquetaNivel } from "../componentes/TarjetaNodo.tsx";
import { type CeldaDia, etiquetaDia, numeroDia } from "./dias.ts";

const NIVELES_ORDEN = ["buena", "regular", "mala", "critica", "sin_datos"] as const;

/**
 * Nivel predominante por día (RF-35). Cada día es un botón con color, símbolo Y texto («14, Regular»): el color solo
 * nunca dice el nivel. Un día sin ningún registro se muestra vacío y se dice «sin registro».
 * 7 días: una barra por día, tan alta como su índice promedio (segunda señal además del color).
 * 30 días: un mosaico de siete columnas, para que cada día siga siendo un objetivo táctil de al menos 44 px.
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
  const semana = celdas.length <= 7;
  const cuenta = new Map<string, number>();
  for (const c of celdas) {
    if (c.datos) cuenta.set(c.datos.nivel, (cuenta.get(c.datos.nivel) ?? 0) + 1);
  }
  const sinRegistro = celdas.filter((c) => !c.datos).length;

  return (
    <div className="grid gap-3">
      <div
        className={`tira ${semana ? "tira-semana" : "tira-mes"}`}
        role="group"
        aria-label="Nivel predominante por día"
      >
        {celdas.map((c) => {
          const nivel = c.datos?.nivel ?? null;
          const texto = nivel ? etiquetaNivel(nivel) : "Sin registro";
          const Icono = nivel ? ICONO_ESTADO[nivel] : null;
          const altura = Math.max(28, c.datos?.wqi_prom ?? 36);
          return (
            <button
              key={c.dia}
              type="button"
              className={`dia ${nivel ? `nivel-${nivel}` : "vacio"} ${elegido === c.dia ? "elegido" : ""}`}
              aria-pressed={elegido === c.dia}
              aria-label={`${etiquetaDia(c.dia)}: ${texto}`}
              onClick={() => alElegir(c.dia)}
            >
              {semana ? (
                <>
                  <span className="barra" style={{ height: `${altura}%` }}>
                    {Icono && <Icono tamano={16} grosor={2.8} />}
                  </span>
                  <span className="numero">{numeroDia(c.dia)}</span>
                </>
              ) : (
                <>
                  <span className="numero">{numeroDia(c.dia)}</span>
                  <span className="nivel" aria-hidden="true">
                    {Icono ? <Icono tamano={13} grosor={3} /> : "—"}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>

      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-sm text-text-2">
        {NIVELES_ORDEN.filter((n) => cuenta.has(n)).map((n) => {
          const Icono = ICONO_ESTADO[n];
          const veces = cuenta.get(n) ?? 0;
          return (
            <li key={n} className={`nivel-${n} inline-flex items-center gap-1.5`}>
              <span className="grid size-[18px] place-items-center rounded-md bg-(--fondo) text-on-state">
                <Icono tamano={12} grosor={3} />
              </span>
              {veces} {veces === 1 ? "día" : "días"} · {etiquetaNivel(n)}
            </li>
          );
        })}
        {sinRegistro > 0 && (
          <li className="inline-flex items-center gap-1.5">
            <span className="size-[18px] rounded-md border border-dashed border-line-strong" />
            {sinRegistro} sin registro
          </li>
        )}
      </ul>
    </div>
  );
}

/** Lo que pasó el día elegido: nivel predominante, reparto de evaluaciones, WQI y promedios por parámetro. */
export function PanelDia({ celda }: { celda: CeldaDia }) {
  const d = celda.datos;
  if (!d) {
    return (
      <div className="panel-dia tarjeta grid gap-1 p-4">
        <h3 className="m-0">{etiquetaDia(celda.dia)}</h3>
        <p className="m-0">Sin registro: el nodo no mandó datos ese día.</p>
      </div>
    );
  }
  const total = NIVELES_ORDEN.reduce((s, n) => s + d.evaluaciones[n], 0);
  return (
    <div className="panel-dia tarjeta grid gap-1.5 p-4">
      <h3 className="m-0">{etiquetaDia(celda.dia)}</h3>
      <p className="m-0">
        Nivel predominante: <strong>{etiquetaNivel(d.nivel)}</strong>
      </p>
      <p className="detalle m-0">
        De {total} evaluaciones:{" "}
        {NIVELES_ORDEN.filter((n) => d.evaluaciones[n] > 0)
          .map((n) => `${d.evaluaciones[n]} ${etiquetaNivel(n).toLowerCase()}`)
          .join(", ") || "ninguna"}
        .
      </p>
      {d.wqi_prom !== null && (
        <p className="detalle m-0">
          Índice de calidad: promedio {Math.round(d.wqi_prom)}
          {d.wqi_min !== null ? `, mínimo ${Math.round(d.wqi_min)}` : ""} (de 0 a 100).
        </p>
      )}
      {d.promedios && (
        <dl className="valores mt-2">
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
