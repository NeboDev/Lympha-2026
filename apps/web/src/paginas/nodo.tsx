import { useState } from "react";
import { Link, useParams } from "react-router";
import { useHistorial, useLecturas, useNodo } from "../api/consultas.ts";
import { mensajeDeError } from "../api/mensajes.ts";
import { IcoAtras, IcoInfo } from "../componentes/Iconos.tsx";
import {
  type ClaveParametro,
  formatearValor,
  PARAMETROS,
  parametroDe,
} from "../componentes/parametros.ts";
import { AvisoFlujo, TarjetaNodo } from "../componentes/TarjetaNodo.tsx";
import { combinar, sseVacio } from "../espacios/estado.ts";
import { haceCuanto } from "../espacios/tiempo.ts";
import { useAhora, useEstadoEspacio } from "../espacios/useEstadoEspacio.ts";
import { GraficaLinea } from "../graficas/GraficaLinea.tsx";
import { completarRango, etiquetaCorta } from "../historial/dias.ts";
import { PanelDia, TiraDias } from "../historial/TiraDias.tsx";

const CLAVE_AVANZADO = "lympha.avanzado";

/** El modo avanzado es una comodidad de cada persona: se recuerda en el navegador si se puede, y si no, no pasa nada. */
function leerAvanzado(): boolean {
  try {
    return localStorage.getItem(CLAVE_AVANZADO) === "1";
  } catch {
    return false;
  }
}
function guardarAvanzado(valor: boolean) {
  try {
    localStorage.setItem(CLAVE_AVANZADO, valor ? "1" : "0");
  } catch {
    // sin almacenamiento: la preferencia dura lo que dure la pantalla
  }
}

const horaCorta = (x: number) =>
  new Date(x).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });

/** Detalle de un nodo: su estado en vivo, el historial de 7 o 30 días y, en modo avanzado, valores y gráficas. */
export function Nodo() {
  const { nodoId = "" } = useParams();
  const nodo = useNodo(nodoId);
  const espacioId = nodo.data?.espacio_id ?? "";
  const { nodos, flujo } = useEstadoEspacio(espacioId);
  const ahora = useAhora();
  const [dias, setDias] = useState<7 | 30>(7);
  const [elegido, setElegido] = useState<string | null>(null);
  const [avanzado, setAvanzadoEstado] = useState(leerAvanzado);
  const [clave, setClave] = useState<ClaveParametro>("ph");
  const historial = useHistorial(nodoId, dias);
  const lecturas = useLecturas(nodoId, 500, avanzado);

  if (nodo.isPending) {
    return (
      <main className="pagina">
        <p role="status" className="detalle">
          Cargando…
        </p>
      </main>
    );
  }
  if (nodo.isError) {
    return (
      <main className="pagina">
        <p role="alert">{mensajeDeError(nodo.error)}</p>
        <Link to="/" className="volver">
          <IcoAtras tamano={20} /> Volver al inicio
        </Link>
      </main>
    );
  }

  const vista = nodos.find((n) => n.id === nodoId) ?? combinar([nodo.data], sseVacio, 0)[0];
  const celdas = completarRango(historial.data?.historial ?? [], dias, ahora);
  const celdaElegida =
    celdas.find((c) => c.dia === elegido) ??
    [...celdas].reverse().find((c) => c.datos !== null) ??
    celdas.at(-1);
  const parametro = parametroDe(clave);

  const cambiarAvanzado = (valor: boolean) => {
    setAvanzadoEstado(valor);
    guardarAvanzado(valor);
  };

  return (
    <main className="pagina grid gap-6">
      <Link
        to={nodo.data.espacio_id ? `/espacios/${nodo.data.espacio_id}` : "/"}
        className="volver"
      >
        <IcoAtras tamano={20} />
        {nodo.data.espacio_id ? "Volver al espacio" : "Volver al inicio"}
      </Link>
      <header className="grid gap-0.5">
        <h1 className="m-0">{nodo.data.nombre ?? "Nodo sin nombre"}</h1>
        <p className="detalle m-0">Perfil de uso: {nodo.data.perfil_id}</p>
      </header>

      <AvisoFlujo flujo={flujo} />
      {vista && <TarjetaNodo nodo={vista} ahora={ahora} conEnlace={false} grande />}

      <section className="tarjeta grid gap-4 p-5" aria-labelledby="h-historial">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="h-historial" className="m-0">
            Historial
          </h2>
          <div className="selector seg" role="group" aria-label="Periodo del historial">
            {([7, 30] as const).map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={dias === n}
                onClick={() => {
                  setDias(n);
                  setElegido(null);
                }}
              >
                {n} días
              </button>
            ))}
          </div>
        </div>
        {historial.isPending && (
          <p role="status" className="detalle m-0">
            Cargando el historial…
          </p>
        )}
        {historial.isError && <p role="alert">{mensajeDeError(historial.error)}</p>}
        {historial.data && (
          <>
            {historial.data.historial.length === 0 && (
              <p className="m-0">Todavía no hay datos de este periodo.</p>
            )}
            <TiraDias celdas={celdas} elegido={celdaElegida?.dia ?? null} alElegir={setElegido} />
            {celdaElegida && <PanelDia celda={celdaElegida} />}
          </>
        )}
      </section>

      <section className="tarjeta grid gap-4 p-5" aria-labelledby="h-valores">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="h-valores" className="m-0">
              Valores y gráficas
            </h2>
            <p className="detalle m-0">Los números y las curvas de cada parámetro.</p>
          </div>
          <label className="interruptor">
            <input
              type="checkbox"
              checked={avanzado}
              onChange={(e) => cambiarAvanzado(e.target.checked)}
            />
            Modo avanzado
          </label>
        </div>

        {avanzado && (
          <>
            <h3 className="m-0">Valores más recientes</h3>
            <dl className="valores">
              {PARAMETROS.map((p) => (
                <div key={p.clave}>
                  <dt>{p.nombre}</dt>
                  <dd>{formatearValor(p, vista?.valores?.[p.clave])}</dd>
                </div>
              ))}
            </dl>
            {vista?.ultimaLecturaEn && (
              <p className="detalle m-0">
                Última lectura {haceCuanto(vista.ultimaLecturaEn, ahora)}.
              </p>
            )}
            {vista && vista.wqi !== null && (
              <p className="m-0 flex items-start gap-2 rounded-ctl bg-surface-2 p-3 text-sm">
                <IcoInfo tamano={16} className="mt-0.5 shrink-0" />
                <span>
                  Índice de calidad en la última evaluación: {Math.round(vista.wqi)} de 100. El
                  nivel del semáforo solo cambia tras varias lecturas seguidas, así que puede ir por
                  detrás de este número.
                </span>
              </p>
            )}

            <div
              className="selector seg flex-wrap"
              role="group"
              aria-label="Parámetro de las gráficas"
            >
              {PARAMETROS.map((p) => (
                <button
                  key={p.clave}
                  type="button"
                  aria-pressed={clave === p.clave}
                  onClick={() => setClave(p.clave)}
                >
                  {p.nombre.replace(" (TDS)", "")}
                </button>
              ))}
            </div>

            {lecturas.isPending && (
              <p role="status" className="detalle m-0">
                Cargando las lecturas…
              </p>
            )}
            {lecturas.isError && <p role="alert">{mensajeDeError(lecturas.error)}</p>}
            {lecturas.data && (
              <GraficaLinea
                titulo={`${parametro.nombre}: últimas ${lecturas.data.lecturas.length} lecturas`}
                parametro={parametro}
                formatoX={horaCorta}
                puntos={[...lecturas.data.lecturas].reverse().map((l) => ({
                  x: Date.parse(l.ts),
                  y: l[clave],
                }))}
              />
            )}
            {historial.data && (
              <GraficaLinea
                titulo={`${parametro.nombre}: promedio diario de ${dias} días`}
                parametro={parametro}
                formatoX={(x) => etiquetaCorta(new Date(x).toISOString().slice(0, 10))}
                puntos={celdas.map((c) => ({
                  x: Date.parse(`${c.dia}T12:00:00Z`),
                  y: c.datos?.promedios?.[clave] ?? null,
                }))}
              />
            )}
          </>
        )}
      </section>
    </main>
  );
}
