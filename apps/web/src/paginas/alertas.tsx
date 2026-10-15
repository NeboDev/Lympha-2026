import type { AlarmaApi, EspacioApi } from "@lympha/contracts";
import { useState } from "react";
import { Link } from "react-router";
import {
  ETIQUETA_ESTADO,
  ETIQUETA_SEVERIDAD,
  lineaDeEstado,
  SIMBOLO_SEVERIDAD,
  titulo,
} from "../alertas/textos.ts";
import { useAlarmas, useAtenderAlarma, useEspacios } from "../api/consultas.ts";
import { mensajeDeError } from "../api/mensajes.ts";
import { etiquetaTipo } from "../componentes/etiquetas.ts";
import { useEstadoEspacio } from "../espacios/useEstadoEspacio.ts";

/** Color del borde: el nivel en las de calidad; el de «revisar» en las de sensor; gris en las de conexión. */
const claseDeColor = (a: AlarmaApi) =>
  a.tipo === "nivel"
    ? `nivel-${a.severidad}`
    : a.tipo === "sensor"
      ? "nivel-revisar"
      : "nivel-sin_conexion";

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
    <li className={`alerta ${claseDeColor(alarma)} estado-${alarma.estado}`}>
      <div className="cabecera-alerta">
        <strong>{titulo(alarma)}</strong>
        {/* la severidad solo significa algo en las alertas de calidad; las de conexión y sensor no tienen nivel */}
        {alarma.tipo === "nivel" && (
          <span className="insignia">
            <span aria-hidden="true">{SIMBOLO_SEVERIDAD[alarma.severidad]}</span>{" "}
            {ETIQUETA_SEVERIDAD[alarma.severidad]}
          </span>
        )}
        <span className="etiqueta-estado">{ETIQUETA_ESTADO[alarma.estado]}</span>
      </div>
      <p className="detalle">
        <Link to={`/nodos/${alarma.nodo_id}`}>{alarma.nodo_nombre ?? "Nodo sin nombre"}</Link> ·{" "}
        {lineaDeEstado(alarma)}
      </p>
      {alarma.causa && <p>{alarma.causa}</p>}
      {alarma.estado === "activa" && (
        <button type="button" className="secundario" disabled={atendiendo} onClick={alAtender}>
          Marcar como atendida
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
    <section className="espacio" aria-labelledby={`al-${espacio.id}`}>
      <h2 id={`al-${espacio.id}`}>
        <Link to={`/espacios/${espacio.id}`}>{espacio.nombre}</Link>
      </h2>
      <p className="detalle">{etiquetaTipo(espacio.tipo)}</p>
      {alarmas.isPending && <p role="status">Cargando…</p>}
      {alarmas.isError && <p role="alert">{mensajeDeError(alarmas.error)}</p>}
      {atender.isError && <p role="alert">{mensajeDeError(atender.error)}</p>}
      {alarmas.data && alarmas.data.alarmas.length === 0 && (
        <p>
          {filtro === "abiertas" ? "Sin alertas abiertas por ahora." : "Todavía no hay alertas."}
        </p>
      )}
      <ul className="alertas">
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
    <main className="pagina">
      <h1>Alertas</h1>
      <div className="selector" role="group" aria-label="Qué alertas ver">
        {(
          [
            ["abiertas", "Abiertas"],
            ["todas", "Historial"],
          ] as const
        ).map(([valor, texto]) => (
          <button
            key={valor}
            type="button"
            className={filtro === valor ? "" : "secundario"}
            aria-pressed={filtro === valor}
            onClick={() => setFiltro(valor)}
          >
            {texto}
          </button>
        ))}
      </div>
      {espacios.isPending && <p role="status">Cargando…</p>}
      {espacios.isError && <p role="alert">{mensajeDeError(espacios.error)}</p>}
      {espacios.data?.espacios.length === 0 && <p>Aún no tienes espacios.</p>}
      {espacios.data?.espacios.map((e) => (
        <AlertasDeEspacio key={e.id} espacio={e} filtro={filtro} />
      ))}
      <p className="detalle">
        Los avisos por Telegram se configuran en <Link to="/ajustes">Ajustes</Link>.
      </p>
    </main>
  );
}
