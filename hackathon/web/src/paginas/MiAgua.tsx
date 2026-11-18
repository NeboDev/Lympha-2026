import { useState } from "react";
import type { Alerta, Calibracion, Nodo, Parametro } from "../api/tipos.ts";
import {
  eventos as esquemaEventos,
  nodo as esquemaNodo,
  serie as esquemaSerie,
  listaCalibraciones,
} from "../api/tipos.ts";
import { useConsulta } from "../api/use-consulta.ts";
import { EscalaPh } from "../componentes/EscalaPh.tsx";
import { ESTADOS_UI, estadoVisual } from "../componentes/estados.ts";
import { Icono } from "../componentes/Iconos.tsx";
import {
  Aviso,
  Cargando,
  ErrorConReintento,
  Hace,
  Insignia,
  Vacio,
} from "../componentes/Piezas.tsx";
import { useEspacio } from "../espacio.tsx";
import { Grafica } from "../graficas/Grafica.tsx";
import { useSesion } from "../sesion/contexto.tsx";
import { CLORO_BAJO_PCT, efectividadCloroPct } from "../util/cloro.ts";
import { fechaMx, valorLegible } from "../util/formato.ts";
import { esPh } from "../util/ph.ts";
import { TarjetaDosificacion } from "./Dosificacion.tsx";

const DIA_MS = 86_400_000;

/** Pantalla 2: Mi agua. El estado en vivo, qué hacer, la gráfica y lo que pasó. */
export function MiAgua({ alIr }: { alIr: (r: "comunidad") => void }) {
  const { comunidad, nodos, nodo: elegido } = useEspacio();

  if (!comunidad) return null;
  if (nodos.cargando) return <Cargando texto="Buscando tus nodos…" />;
  if (nodos.error && !nodos.datos)
    return (
      <Aviso
        tipo="error"
        accion={
          <button type="button" className="boton boton-secundario" onClick={nodos.recargar}>
            Intentar de nuevo
          </button>
        }
      >
        {nodos.error}
      </Aviso>
    );
  if (!elegido) {
    return (
      <Vacio
        titulo="Todavía no hay nodos"
        accion={
          comunidad.rol === "responsable" ? (
            <button
              type="button"
              className="boton boton-primario"
              onClick={() => alIr("comunidad")}
            >
              <Icono nombre="mas" /> Vincular un nodo
            </button>
          ) : undefined
        }
      >
        {comunidad.rol === "responsable"
          ? "Vincula el nodo de Blynk de tu comunidad para ver aquí el pH en vivo."
          : "Cuando la persona responsable vincule un nodo, el pH aparecerá aquí."}
      </Vacio>
    );
  }
  return <VistaNodo id={elegido.id} />;
}

function VistaNodo({ id }: { id: string }) {
  const { api } = useSesion();
  const detalle = useConsulta(
    (signal) => api.pedir(`/api/nodos/${id}`, { esquema: esquemaNodo, signal }),
    [api, id],
    { cadaMs: 5000 },
  );
  const n = detalle.datos;

  if (detalle.cargando && !n) return <Cargando texto="Leyendo el agua…" />;
  if (!n) {
    return (
      <Aviso
        tipo="error"
        accion={
          <button type="button" className="boton boton-secundario" onClick={detalle.recargar}>
            Intentar de nuevo
          </button>
        }
      >
        {detalle.error ?? "No pudimos leer este nodo."}
      </Aviso>
    );
  }

  const principal = n.parametros[0];
  return (
    <>
      <header className="encabezado-nodo">
        <h1>{n.nombre}</h1>
        {n.ubicacion && <p className="nota">{n.ubicacion.texto}</p>}
      </header>
      {detalle.error && (
        <Aviso tipo="error">{detalle.error} Mostramos lo último que recibimos.</Aviso>
      )}
      {principal ? <TarjetaEstado nodo={n} parametro={principal} /> : null}
      {principal && esPh(principal.id) && (
        <TarjetaCloro
          valor={n.ultimo?.v[principal.id] ?? null}
          conectado={n.conexion === "conectado"}
        />
      )}
      <TarjetaDosificacion nodo={n} />
      <Alertas nodoId={n.id} />
      {principal && <SeccionGrafica nodoId={n.id} parametro={principal} />}
      <UltimaCalibracion nodoId={n.id} />
      <p className="nota">Atl no certifica el agua; te ayuda a vigilarla y a documentarla.</p>
    </>
  );
}

function TarjetaEstado({ nodo, parametro }: { nodo: Nodo; parametro: Parametro }) {
  const estado = estadoVisual(nodo);
  const info = ESTADOS_UI[estado];
  const u = nodo.ultimo;
  const valor = u?.v[parametro.id] ?? null;
  const norma = parametro.norma;
  // Un nodo sin conexión muestra su último valor atenuado y rotulado, para no pasarlo por una lectura actual.
  const viejo = estado === "sin_conexion";
  return (
    <section
      className="tarjeta tarjeta-estado"
      style={{ background: info.suave }}
      aria-label="Estado del agua"
    >
      <div className="estado-cabecera">
        <Insignia estado={estado} grande />
        <span className="estado-parametro">{parametro.nombre}</span>
      </div>
      <p className={viejo ? "ph-grande ph-viejo" : "ph-grande"} aria-live="polite">
        <span className="cifra">{valorLegible(valor, parametro.decimales)}</span>
        {parametro.unidad && <span className="unidad">{parametro.unidad}</span>}
      </p>
      {valor !== null && esPh(parametro.id) && (
        <EscalaPh valor={valor} min={norma?.min ?? null} max={norma?.max ?? null} />
      )}
      {norma && (
        <p className="nota">
          Rango recomendado: {valorLegible(norma.min, parametro.decimales)} a{" "}
          {valorLegible(norma.max, parametro.decimales)}
          {parametro.unidad ? ` ${parametro.unidad}` : ""} ({norma.fuente})
        </p>
      )}
      {u ? (
        <p className="linea-lectura">
          {viejo
            ? "último dato"
            : u.estable === null
              ? "lectura"
              : u.estable
                ? "lectura estable"
                : "lectura cambiando"}
          {" · "}
          <Hace fecha={u.ts} />
        </p>
      ) : null}
      <p className="que-hacer">{info.queHacer}</p>
    </section>
  );
}

function TarjetaCloro({ valor, conectado }: { valor: number | null; conectado: boolean }) {
  const pct = conectado ? efectividadCloroPct(valor) : null;
  if (pct === null) return null;
  return (
    <section className="tarjeta tarjeta-mini" aria-label="Efectividad del cloro">
      <Icono nombre="gota" />
      <div>
        <p className="mini-titulo">Efectividad del cloro con este pH: ~{pct} %</p>
        <p className="nota">
          Es la parte del cloro libre que actúa en su forma más efectiva. Es una estimación a 25 °C:
          Atl no mide el cloro.
        </p>
        {pct < CLORO_BAJO_PCT && (
          <p className="que-hacer-chico">
            Con este pH el cloro actúa con poca fuerza: conviene corregir el pH antes de subir la
            dosis.
          </p>
        )}
      </div>
    </section>
  );
}

function Alertas({ nodoId }: { nodoId: string }) {
  const { api } = useSesion();
  const e = useConsulta(
    (signal) =>
      api.pedir(`/api/nodos/${nodoId}/eventos?limite=20`, { esquema: esquemaEventos, signal }),
    [api, nodoId],
    { cadaMs: 30_000 },
  );
  const abiertas: Alerta[] = (e.datos?.alertas ?? []).filter((a) => a.estado === "abierta");
  if (abiertas.length === 0) return null;
  return (
    <section className="tarjeta" aria-label="Alertas abiertas">
      <h2>Alertas abiertas</h2>
      <ul className="lista">
        {abiertas.map((a) => (
          <li key={a.id}>
            <strong>{a.titulo}</strong>
            <span className="nota">
              {fechaMx(a.abierta)} · {a.detalle}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SeccionGrafica({ nodoId, parametro }: { nodoId: string; parametro: Parametro }) {
  const { api } = useSesion();
  const [dias, setDias] = useState<1 | 7>(1);
  const s = useConsulta(
    (signal) => {
      const hasta = new Date();
      const desde = new Date(hasta.getTime() - dias * DIA_MS);
      return api.pedir(
        `/api/nodos/${nodoId}/muestras?desde=${encodeURIComponent(desde.toISOString())}&hasta=${encodeURIComponent(hasta.toISOString())}`,
        { esquema: esquemaSerie, signal },
      );
    },
    [api, nodoId, dias],
    { cadaMs: 60_000 },
  );
  return (
    <section className="tarjeta" aria-label={`Gráfica de ${parametro.nombre}`}>
      <div className="fila-titulo">
        <h2>{parametro.nombre} en el tiempo</h2>
        <fieldset className="fichas">
          <legend className="solo-lectores">Periodo de la gráfica</legend>
          {([1, 7] as const).map((d) => (
            <button
              key={d}
              type="button"
              className={d === dias ? "ficha ficha-activa" : "ficha"}
              aria-pressed={d === dias}
              onClick={() => setDias(d)}
            >
              {d === 1 ? "24 horas" : "7 días"}
            </button>
          ))}
        </fieldset>
      </div>
      {s.cargando && !s.datos ? <Cargando texto="Dibujando la gráfica…" /> : null}
      {s.error && !s.datos ? <ErrorConReintento error={s.error} alReintentar={s.recargar} /> : null}
      {s.datos ? <Grafica serie={s.datos} parametro={parametro} /> : null}
    </section>
  );
}

function UltimaCalibracion({ nodoId }: { nodoId: string }) {
  const { api } = useSesion();
  const c = useConsulta(
    (signal) =>
      api.pedir(`/api/nodos/${nodoId}/calibraciones`, { esquema: listaCalibraciones, signal }),
    [api, nodoId],
    { cadaMs: 120_000 },
  );
  const ultima: Calibracion | undefined = c.datos?.calibraciones[0];
  if (!c.datos) return null;
  const diag = { buena: "Buena", desgastada: "Desgastada", revisar: "Revisar" } as const;
  return (
    <section className="tarjeta tarjeta-mini" aria-label="Calibración de la sonda">
      <Icono nombre="sonda" />
      <div>
        {ultima ? (
          <>
            <p className="mini-titulo">
              Última calibración: {diag[ultima.diagnostico]} (
              {ultima.pendiente_pct_nernst.toFixed(1)} % de Nernst)
            </p>
            <p className="nota">
              {fechaMx(ultima.ts)}. Mientras más cerca de 100 %, mejor responde la sonda.
            </p>
          </>
        ) : (
          <>
            <p className="mini-titulo">Sin calibraciones registradas</p>
            <p className="nota">
              Cuando se calibre la sonda, el resultado aparecerá aquí y en el reporte.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
