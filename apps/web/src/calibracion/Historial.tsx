import type { CalibracionApi } from "@lympha/contracts";
import { useState } from "react";
import { useAccionesCalibracion, useCalibraciones } from "../api/consultas-calibracion.ts";
import { mensajeDeError } from "../api/mensajes.ts";
import { IcoCheck, IcoReloj } from "../componentes/Iconos.tsx";
import { fechaMexico, NOMBRES_PARAMETRO_CAL, numeroCal } from "./utilidades.ts";

/**
 * Historial de calibraciones de un nodo. Quien administra el espacio puede volver a una anterior o restablecer
 * la identidad (pendiente 1, desfase 0) de un parámetro; los demás solo consultan.
 */
export function Historial({ nodoId, puedeEditar }: { nodoId: string; puedeEditar: boolean }) {
  const historial = useCalibraciones(nodoId);
  const acciones = useAccionesCalibracion(nodoId);
  const [pendiente, setPendiente] = useState<string | null>(null);

  if (historial.isPending) {
    return (
      <p role="status" className="detalle">
        Cargando el historial…
      </p>
    );
  }
  if (historial.isError) return <p role="alert">{mensajeDeError(historial.error)}</p>;

  const filas = historial.data.calibraciones;
  const error = acciones.activar.error ?? acciones.restablecer.error;

  return (
    <section className="tarjeta grid gap-3 p-5" aria-labelledby="h-historial-cal">
      <h2 id="h-historial-cal" className="m-0">
        Historial de calibraciones
      </h2>
      {filas.length === 0 ? (
        <p className="m-0 flex items-center gap-2 text-text-2">
          <IcoReloj tamano={18} /> Este nodo todavía no se ha calibrado.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {filas.map((c) => (
            <Fila
              key={c.id}
              c={c}
              puedeEditar={puedeEditar}
              confirmando={pendiente === c.id}
              ocupado={acciones.activar.isPending || acciones.restablecer.isPending}
              alPedir={() => setPendiente(c.id)}
              alCancelar={() => setPendiente(null)}
              alActivar={() =>
                acciones.activar.mutate(c.id, { onSettled: () => setPendiente(null) })
              }
            />
          ))}
        </ul>
      )}
      {puedeEditar && filas.some((c) => c.activa && c.origen === "guiada") && (
        <div className="grid gap-2 border-t border-line pt-3">
          <p className="detalle m-0">
            Restablecer deja un parámetro sin corrección (pendiente 1, desfase 0). Queda anotado en
            el historial.
          </p>
          <div className="flex flex-wrap gap-2">
            {filas
              .filter((c) => c.activa && c.origen === "guiada")
              .map((c) => (
                <button
                  key={c.parametro}
                  type="button"
                  className="secundario"
                  disabled={acciones.restablecer.isPending}
                  onClick={() => acciones.restablecer.mutate(c.parametro)}
                >
                  Restablecer {NOMBRES_PARAMETRO_CAL[c.parametro]}
                </button>
              ))}
          </div>
        </div>
      )}
      {error && <p role="alert">{mensajeDeError(error)}</p>}
    </section>
  );
}

function Fila({
  c,
  puedeEditar,
  confirmando,
  ocupado,
  alPedir,
  alCancelar,
  alActivar,
}: {
  c: CalibracionApi;
  puedeEditar: boolean;
  confirmando: boolean;
  ocupado: boolean;
  alPedir: () => void;
  alCancelar: () => void;
  alActivar: () => void;
}) {
  return (
    <li className="grid gap-1 rounded-ctl border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{NOMBRES_PARAMETRO_CAL[c.parametro]}</strong>
        {c.activa ? (
          <span className="insignia nivel-buena">
            <IcoCheck tamano={15} grosor={2.6} />
            <span>En uso</span>
          </span>
        ) : (
          <span className="detalle text-xs">Anterior</span>
        )}
      </div>
      <p className="detalle m-0">
        <time dateTime={c.creado_en}>{fechaMexico(c.creado_en)}</time>
        {c.origen === "identidad"
          ? " · restablecida (sin corrección)"
          : ` · ${c.puntos.length} puntos`}
      </p>
      <p className="m-0 tabular-nums text-sm">
        Pendiente {numeroCal(c.pendiente)} · Desfase {numeroCal(c.desfase)}
        {c.r2 !== null && c.puntos.length >= 3 ? ` · R² ${numeroCal(c.r2)}` : ""}
      </p>
      {puedeEditar &&
        !c.activa &&
        (confirmando ? (
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Confirmar volver a esta calibración"
          >
            <button type="button" disabled={ocupado} onClick={alActivar}>
              Sí, usar esta
            </button>
            <button type="button" className="secundario" onClick={alCancelar}>
              Cancelar
            </button>
          </div>
        ) : (
          <button type="button" className="enlace justify-self-start" onClick={alPedir}>
            Volver a esta calibración
          </button>
        ))}
    </li>
  );
}
