import { PARAMETROS_CALIBRABLES, type ParametroCalibrable } from "@lympha/calibracion";
import { useSearchParams } from "react-router";
import { useMisNodos } from "../api/consultas-calibracion.ts";
import { mensajeDeError } from "../api/mensajes.ts";
import { Asistente } from "../calibracion/Asistente.tsx";
import { Historial } from "../calibracion/Historial.tsx";
import { InsigniaCalibracion } from "../calibracion/InsigniaCalibracion.tsx";
import { useEnLinea } from "../calibracion/useEnLinea.ts";
import { Vacio } from "../componentes/estados.tsx";
import { IcoCalibrar, IcoSinRed } from "../componentes/Iconos.tsx";
import { AvisoFlujo } from "../componentes/TarjetaNodo.tsx";
import { useAhora, useEstadoEspacio } from "../espacios/useEstadoEspacio.ts";

const esParametro = (x: string | null): x is ParametroCalibrable =>
  x !== null && (PARAMETROS_CALIBRABLES as readonly string[]).includes(x);

/** Pestaña «Calibración»: elegir nodo, asistente guiado por parámetro e historial con opción de revertir. */
export function Calibracion() {
  const { nodos, cargando, error } = useMisNodos();
  const enLinea = useEnLinea();
  const ahora = useAhora();
  const [busqueda, setBusqueda] = useSearchParams();

  const activos = nodos.filter(({ nodo }) => nodo.estado !== "desvinculado");
  const elegido = activos.find(({ nodo }) => nodo.id === busqueda.get("nodo")) ?? activos[0];
  const parametroInicial = busqueda.get("parametro");
  const { flujo } = useEstadoEspacio(elegido?.espacio.id ?? "");

  return (
    <main className="pagina grid gap-6">
      <header className="grid gap-0.5">
        <h1 className="m-0 flex items-center gap-2">
          <IcoCalibrar tamano={28} /> Calibración
        </h1>
        <p className="detalle m-0">
          Ajusta los sensores con soluciones patrón para que las lecturas se acerquen al valor real.
          Se hace junto al nodo, con la sonda a la mano.
        </p>
      </header>

      {!enLinea && (
        <p role="status" className="tarjeta m-0 flex items-center gap-3 p-4">
          <IcoSinRed tamano={22} className="shrink-0" />
          <span>
            Sin conexión. Puedes ver esta pantalla, pero calibrar necesita las lecturas en vivo y
            guardar en Lympha: vuelve a intentarlo cuando tengas red.
          </span>
        </p>
      )}

      {cargando && (
        <p role="status" className="detalle m-0">
          Cargando tus nodos…
        </p>
      )}
      {error !== null && <p role="alert">{mensajeDeError(error)}</p>}
      {!cargando && error === null && activos.length === 0 && (
        <Vacio icono={IcoCalibrar}>
          Todavía no tienes nodos para calibrar. Reclama uno desde un espacio y vuelve aquí.
        </Vacio>
      )}

      {activos.length > 0 && (
        <section aria-labelledby="h-nodos" className="grid gap-2">
          <h2 id="h-nodos" className="m-0">
            Tus nodos
          </h2>
          <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
            {activos.map(({ nodo, espacio }) => {
              const seleccionado = nodo.id === elegido?.nodo.id;
              return (
                <li key={nodo.id}>
                  <button
                    type="button"
                    aria-pressed={seleccionado}
                    className={`tarjeta grid w-full gap-1 p-4 text-left ${seleccionado ? "border-2 border-brand" : ""}`}
                    onClick={() => setBusqueda({ nodo: nodo.id }, { replace: true })}
                  >
                    <strong>{nodo.nombre ?? "Nodo sin nombre"}</strong>
                    <span className="detalle text-sm">{espacio.nombre}</span>
                    {nodo.calibracion && (
                      <InsigniaCalibracion resumen={nodo.calibracion} ahora={ahora} />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {elegido && (
        <>
          <AvisoFlujo flujo={flujo} />
          {elegido.espacio.rol !== "propietario" && (
            <p role="status" className="detalle m-0">
              Solo quien administra el espacio puede calibrar. Aquí ves el historial.
            </p>
          )}
          {enLinea && elegido.espacio.rol === "propietario" && (
            <Asistente
              // al cambiar de nodo el asistente empieza de cero
              key={`${elegido.nodo.id}-${parametroInicial ?? ""}`}
              nodoId={elegido.nodo.id}
              nombreNodo={elegido.nodo.nombre ?? "este nodo"}
              parametroInicial={esParametro(parametroInicial) ? parametroInicial : undefined}
            />
          )}
          <Historial
            key={elegido.nodo.id}
            nodoId={elegido.nodo.id}
            puedeEditar={enLinea && elegido.espacio.rol === "propietario"}
          />
        </>
      )}
    </main>
  );
}
