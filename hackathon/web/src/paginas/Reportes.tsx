import { useState } from "react";
import { mensajeDeError } from "../api/mensajes.ts";
import { serie as esquemaSerie, listaReportes, type Reporte } from "../api/tipos.ts";
import { useConsulta } from "../api/use-consulta.ts";
import { Icono } from "../componentes/Iconos.tsx";
import { Aviso, Cargando, ErrorConReintento, Vacio } from "../componentes/Piezas.tsx";
import { useEspacio } from "../espacio.tsx";
import { useSesion } from "../sesion/contexto.tsx";
import { descargarArchivo } from "../util/descarga.ts";
import { aInputLocal, desdeInputLocal, fechaMx, valorLegible } from "../util/formato.ts";
import { resumenLinea, vistaPrevia } from "./reportes-calculo.ts";

const DIA_MS = 86_400_000;
const MAX_DIAS = 90;

type Periodo = { tipo: "dias"; dias: 1 | 7 | 30 } | { tipo: "otro" };

const OPCIONES: { clave: string; texto: string; periodo: Periodo }[] = [
  { clave: "1", texto: "Hoy (24 h)", periodo: { tipo: "dias", dias: 1 } },
  { clave: "7", texto: "7 días", periodo: { tipo: "dias", dias: 7 } },
  { clave: "30", texto: "30 días", periodo: { tipo: "dias", dias: 30 } },
  { clave: "otro", texto: "Personalizado", periodo: { tipo: "otro" } },
];

/** Pantalla 3: Reportes. Elegir el periodo, ver las cifras clave, descargar el PDF y revisar los anteriores. */
export function Reportes() {
  const { nodo } = useEspacio();
  if (!nodo) {
    return (
      <Vacio titulo="Todavía no hay un nodo">
        Cuando vincules un nodo podrás descargar su reporte aquí.
      </Vacio>
    );
  }
  return <ReportesDeNodo key={nodo.id} nodoId={nodo.id} />;
}

function ReportesDeNodo({ nodoId }: { nodoId: string }) {
  const { api } = useSesion();
  const { nodo } = useEspacio();
  const [periodo, setPeriodo] = useState<Periodo>({ tipo: "dias", dias: 7 });
  const [desdeTxt, setDesdeTxt] = useState(() => aInputLocal(new Date(Date.now() - 7 * DIA_MS)));
  const [hastaTxt, setHastaTxt] = useState(() => aInputLocal(new Date()));
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Las fechas del periodo elegido: «N días» cuenta hacia atrás desde ahora; «personalizado» usa los campos.
  const rango = (() => {
    if (periodo.tipo === "dias") {
      const hasta = new Date();
      return {
        desde: new Date(hasta.getTime() - periodo.dias * DIA_MS),
        hasta,
        problema: null as string | null,
      };
    }
    const desde = desdeInputLocal(desdeTxt);
    const hasta = desdeInputLocal(hastaTxt);
    if (!desde || !hasta) return { desde: null, hasta: null, problema: "Elige las dos fechas." };
    if (desde >= hasta)
      return { desde, hasta, problema: "La fecha de inicio debe ser anterior a la final." };
    if (hasta.getTime() - desde.getTime() > MAX_DIAS * DIA_MS) {
      return { desde, hasta, problema: `El periodo no puede pasar de ${MAX_DIAS} días.` };
    }
    return { desde, hasta, problema: null };
  })();

  const parametros = nodo?.parametros ?? [];
  const principal = parametros[0];
  const clavePeriodo = periodo.tipo === "dias" ? `d${periodo.dias}` : `${desdeTxt}|${hastaTxt}`;

  const previa = useConsulta(
    (signal) => {
      if (!rango.desde || !rango.hasta) throw new Error("sin periodo");
      return api.pedir(
        `/api/nodos/${nodoId}/muestras?desde=${encodeURIComponent(rango.desde.toISOString())}&hasta=${encodeURIComponent(rango.hasta.toISOString())}`,
        { esquema: esquemaSerie, signal },
      );
    },
    [api, nodoId, clavePeriodo],
    { activa: rango.problema === null && principal !== undefined },
  );
  const anteriores = useConsulta(
    (signal) =>
      api.pedir(`/api/nodos/${nodoId}/reportes?limite=10`, { esquema: listaReportes, signal }),
    [api, nodoId],
  );

  async function descargar(desde: Date, hasta: Date) {
    setError(null);
    setAviso(null);
    setGenerando(true);
    try {
      const archivo = await api.descargar(`/api/nodos/${nodoId}/reportes`, {
        metodo: "POST",
        cuerpo: { desde: desde.toISOString(), hasta: hasta.toISOString() },
      });
      descargarArchivo(archivo.blob, archivo.nombre);
      setAviso(`Listo: se descargó ${archivo.nombre}.`);
      anteriores.recargar();
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setGenerando(false);
    }
  }

  const v = previa.datos && principal ? vistaPrevia(previa.datos, principal.id) : null;
  const dec = principal?.decimales ?? 2;
  const unidad = principal?.unidad ? ` ${principal.unidad}` : "";

  return (
    <>
      <header className="encabezado-nodo">
        <h1>Reportes</h1>
        <p className="nota">
          Una bitácora en PDF del agua de «{nodo?.nombre}»: cifras, gráfica, alertas y lo que no
          cubre.
        </p>
      </header>

      <section className="tarjeta" aria-label="Periodo del reporte">
        <h2>Periodo</h2>
        <fieldset className="fichas">
          <legend className="solo-lectores">Periodo</legend>
          {OPCIONES.map((o) => {
            const activa =
              o.periodo.tipo === periodo.tipo &&
              (o.periodo.tipo === "otro" ||
                (periodo.tipo === "dias" && periodo.dias === o.periodo.dias));
            return (
              <button
                key={o.clave}
                type="button"
                className={activa ? "ficha ficha-activa" : "ficha"}
                aria-pressed={activa}
                onClick={() => setPeriodo(o.periodo)}
              >
                {o.texto}
              </button>
            );
          })}
        </fieldset>

        {periodo.tipo === "otro" && (
          <div className="campos-fecha">
            <label>
              Desde
              <input
                type="datetime-local"
                value={desdeTxt}
                onChange={(e) => setDesdeTxt(e.target.value)}
              />
            </label>
            <label>
              Hasta
              <input
                type="datetime-local"
                value={hastaTxt}
                onChange={(e) => setHastaTxt(e.target.value)}
              />
            </label>
          </div>
        )}
        {rango.problema && <Aviso tipo="error">{rango.problema}</Aviso>}

        {rango.problema === null && principal && (
          <div className="vista-previa" aria-live="polite">
            <h3>Vista previa de las cifras clave</h3>
            {previa.cargando && !previa.datos ? <Cargando texto="Calculando…" /> : null}
            {previa.error && !previa.datos ? (
              <ErrorConReintento error={previa.error} alReintentar={previa.recargar} />
            ) : null}
            {v && v.lecturas === 0 ? (
              <p className="nota">
                No hay lecturas de {principal.nombre} en este periodo. El reporte lo dirá con
                claridad.
              </p>
            ) : null}
            {v && v.lecturas > 0 ? (
              <dl className="cifras">
                <div>
                  <dt>Promedio</dt>
                  <dd>
                    {valorLegible(v.promedio, dec)}
                    {unidad}
                  </dd>
                </div>
                <div>
                  <dt>Mínimo</dt>
                  <dd>
                    {valorLegible(v.minimo, dec)}
                    {unidad}
                  </dd>
                </div>
                <div>
                  <dt>Máximo</dt>
                  <dd>
                    {valorLegible(v.maximo, dec)}
                    {unidad}
                  </dd>
                </div>
                <div>
                  <dt>Lecturas</dt>
                  <dd>{v.lecturas}</dd>
                </div>
              </dl>
            ) : null}
            <p className="nota">
              El PDF suma el porcentaje del tiempo dentro del rango, la cobertura de datos, las
              alertas, las calibraciones, la bitácora y lo que este nodo no mide.
            </p>
          </div>
        )}

        {error && <Aviso tipo="error">{error}</Aviso>}
        {aviso && <Aviso>{aviso}</Aviso>}
        <button
          type="button"
          className="boton boton-primario"
          disabled={generando || rango.problema !== null || !rango.desde || !rango.hasta}
          onClick={() => rango.desde && rango.hasta && void descargar(rango.desde, rango.hasta)}
        >
          <Icono nombre="descargar" /> {generando ? "Preparando el PDF…" : "Descargar reporte PDF"}
        </button>
      </section>

      <section className="tarjeta" aria-label="Reportes anteriores">
        <h2>Reportes anteriores</h2>
        {anteriores.cargando && !anteriores.datos ? <Cargando /> : null}
        {anteriores.error && !anteriores.datos ? (
          <ErrorConReintento error={anteriores.error} alReintentar={anteriores.recargar} />
        ) : null}
        {anteriores.datos && anteriores.datos.reportes.length === 0 ? (
          <p className="nota">Todavía no se ha generado ninguno. El primero aparecerá aquí.</p>
        ) : null}
        <ul className="lista">
          {(anteriores.datos?.reportes ?? []).map((r: Reporte) => (
            <li key={r.id}>
              <strong>
                {fechaMx(r.desde, false)} a {fechaMx(r.hasta, false)}
              </strong>
              <span className="nota">{resumenLinea(r, parametros)}</span>
              <span className="nota">
                Generado el {fechaMx(r.generado)} por {r.generado_por} · huella {r.huella}
              </span>
              <button
                type="button"
                className="boton boton-secundario boton-chico"
                disabled={generando}
                onClick={() => void descargar(r.desde, r.hasta)}
              >
                <Icono nombre="descargar" tamano={16} /> Descargar de nuevo
              </button>
            </li>
          ))}
        </ul>
        {(anteriores.datos?.reportes.length ?? 0) > 0 && (
          <p className="nota">
            Los PDF no se guardan: «Descargar de nuevo» arma otro con los datos de ese periodo.
          </p>
        )}
      </section>
    </>
  );
}
