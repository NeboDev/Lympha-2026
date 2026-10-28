import type { AlarmaApi, EspacioApi } from "@lympha/contracts";
import { useState } from "react";
import { Link } from "react-router";
import { ETIQUETA_ESTADO, ETIQUETA_SEVERIDAD, lineaDeEstado, titulo } from "../alertas/textos.ts";
import { useAlarmas, useAtenderAlarma, useEspacios } from "../api/consultas.ts";
import { mensajeDeError } from "../api/mensajes.ts";
import { ICONO_ESTADO, Vacio } from "../componentes/estados.tsx";
import { etiquetaTipo } from "../componentes/etiquetas.ts";
import {
  IcoAdelante,
  IcoCampana,
  IcoCheck,
  IcoCirculoCheck,
  IcoLlave,
  IcoSinRed,
} from "../componentes/Iconos.tsx";
import { useEstadoEspacio } from "../espacios/useEstadoEspacio.ts";

/** Color del borde: el nivel en las de calidad; el de «revisar» en las de sensor; gris en las de conexión. */
const claseDeColor = (a: AlarmaApi) =>
  a.tipo === "nivel"
    ? `nivel-${a.severidad}`
    : a.tipo === "sensor"
      ? "nivel-revisar"
      : "nivel-sin_conexion";

/** El símbolo de la alerta: el del nivel en las de calidad; llave en sensor; sin red en conexión. */
function SimboloAlerta({ alarma }: { alarma: AlarmaApi }) {
  const Icono =
    alarma.tipo === "nivel"
      ? ICONO_ESTADO[alarma.severidad]
      : alarma.tipo === "sensor"
        ? IcoLlave
        : IcoSinRed;
  return <Icono tamano={15} grosor={2.6} />;
}

function Alerta({
  alarma,
  alAtender,
  atendiendo,
}: {
  alarma: AlarmaApi;
  alAtender: () => void;
  atendiendo: boolean;
}) {
  return (
    <li
      className={`alerta ${claseDeColor(alarma)} estado-${alarma.estado} grid gap-2 rounded-card border border-line border-l-[6px] border-l-(--fondo) bg-surface p-4 shadow-1 ${alarma.estado === "resuelta" ? "opacity-80" : ""}`}
    >
      <div className="cabecera-alerta flex flex-wrap items-center gap-2">
        <span className="insignia">
          <SimboloAlerta alarma={alarma} />
          {alarma.tipo === "nivel" ? ETIQUETA_SEVERIDAD[alarma.severidad] : titulo(alarma)}
        </span>
        <strong className="min-w-0 flex-1">{titulo(alarma)}</strong>
        <span className="etiqueta-estado inline-flex items-center gap-1 rounded-full border border-line-strong px-2.5 py-0.5 text-sm font-semibold">
          {alarma.estado !== "activa" && <IcoCheck tamano={14} grosor={3} />}
          {ETIQUETA_ESTADO[alarma.estado]}
        </span>
      </div>
      <p className="detalle m-0">
        <Link to={`/nodos/${alarma.nodo_id}`}>{alarma.nodo_nombre ?? "Nodo sin nombre"}</Link> ·{" "}
        {lineaDeEstado(alarma)}
      </p>
      {alarma.causa && <p className="m-0 font-semibold">{alarma.causa}</p>}
      {alarma.estado === "activa" && (
        <button
          type="button"
          className="secundario justify-self-start"
          disabled={atendiendo}
          onClick={alAtender}
        >
          <IcoCirculoCheck tamano={18} /> Marcar como atendida
        </button>
      )}
    </li>
  );
}

/** Las alertas de un espacio. Escucha el stream del espacio: una alarma nueva o cambiada aparece sin recargar. */
function AlertasDeEspacio({
  espacio,
  filtro,
}: {
  espacio: EspacioApi;
  filtro: "abiertas" | "todas";
}) {
  useEstadoEspacio(espacio.id); // mantiene el stream abierto; sus eventos `alarma` refrescan esta lista
  const alarmas = useAlarmas(espacio.id, filtro);
  const atender = useAtenderAlarma();

  return (
    <section className="espacio grid gap-3" aria-labelledby={`al-${espacio.id}`}>
      <div>
        <h2 id={`al-${espacio.id}`} className="m-0">
          <Link
            to={`/espacios/${espacio.id}`}
            className="inline-flex min-h-11 items-center gap-1 text-text no-underline hover:underline"
          >
            {espacio.nombre}
            <IcoAdelante tamano={20} />
          </Link>
        </h2>
        <p className="detalle m-0">{etiquetaTipo(espacio.tipo)}</p>
      </div>
      {alarmas.isPending && (
        <p role="status" className="detalle m-0">
          Cargando…
        </p>
      )}
      {alarmas.isError && <p role="alert">{mensajeDeError(alarmas.error)}</p>}
      {atender.isError && <p role="alert">{mensajeDeError(atender.error)}</p>}
      {alarmas.data && alarmas.data.alarmas.length === 0 && (
        <Vacio icono={filtro === "abiertas" ? IcoCirculoCheck : IcoCampana}>
          {filtro === "abiertas" ? "Sin alertas abiertas por ahora." : "Todavía no hay alertas."}
        </Vacio>
      )}
      <ul className="alertas m-0 grid list-none gap-3 p-0">
        {alarmas.data?.alarmas.map((a) => (
          <Alerta
            key={a.id}
            alarma={a}
            atendiendo={atender.isPending}
            alAtender={() => atender.mutate(a.id)}
          />
        ))}
      </ul>
    </section>
  );
}

/** Alertas de todos los espacios: las abiertas y el historial (RF-32), con su estado y quién las atendió. */
export function Alertas() {
  const espacios = useEspacios();
  const [filtro, setFiltro] = useState<"abiertas" | "todas">("abiertas");

  return (
    <main className="pagina grid gap-6">
      <header className="grid gap-3">
        <div>
          <h1 className="m-0">Alertas</h1>
          <p className="detalle m-0">Lo que Lympha detectó en tu agua</p>
        </div>
        <div className="selector seg justify-self-start" role="group" aria-label="Qué alertas ver">
          {(
            [
              ["abiertas", "Abiertas"],
              ["todas", "Historial"],
            ] as const
          ).map(([valor, texto]) => (
            <button
              key={valor}
              type="button"
              aria-pressed={filtro === valor}
              onClick={() => setFiltro(valor)}
            >
              {texto}
            </button>
          ))}
        </div>
      </header>
      {espacios.isPending && (
        <p role="status" className="detalle m-0">
          Cargando…
        </p>
      )}
      {espacios.isError && <p role="alert">{mensajeDeError(espacios.error)}</p>}
      {espacios.data?.espacios.length === 0 && <p className="m-0">Aún no tienes espacios.</p>}
      {espacios.data?.espacios.map((e) => (
        <AlertasDeEspacio key={e.id} espacio={e} filtro={filtro} />
      ))}
      <p className="detalle m-0">
        Los avisos por Telegram se configuran en <Link to="/ajustes">Ajustes</Link>.
      </p>
    </main>
  );
}
