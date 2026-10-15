import type { NivelApi } from "@lympha/contracts";
import { Link } from "react-router";
import type { EstadoVisible, NodoVista } from "../espacios/estado.ts";
import { haceCuanto, horaYDia } from "../espacios/tiempo.ts";

/** Texto y símbolo de cada estado: el color nunca es lo único que lo distingue (accesibilidad). */
const ESTADOS: Record<EstadoVisible, { etiqueta: string; simbolo: string }> = {
  buena: { etiqueta: "Buena", simbolo: "✓" },
  regular: { etiqueta: "Regular", simbolo: "!" },
  mala: { etiqueta: "Mala", simbolo: "▲" },
  critica: { etiqueta: "Crítica", simbolo: "✕" },
  sin_datos: { etiqueta: "Sin datos", simbolo: "…" },
  revisar: { etiqueta: "Revisar sensor", simbolo: "?" },
  sin_conexion: { etiqueta: "Sin conexión", simbolo: "–" },
  esperando: { etiqueta: "Esperando la primera lectura", simbolo: "…" },
  deshabilitado: { etiqueta: "Dispositivo deshabilitado", simbolo: "–" },
  sin_vincular: { etiqueta: "Sin vincular", simbolo: "–" },
};

const NOMBRES_PARAMETRO: Record<string, string> = {
  ph: "pH",
  temperatura: "temperatura",
  conductividad: "conductividad",
  turbidez: "turbidez",
  tds: "TDS",
};

export const etiquetaEstadoVisible = (v: EstadoVisible) => ESTADOS[v].etiqueta;
export const etiquetaNivel = (n: NivelApi) => ESTADOS[n].etiqueta;
export const simboloNivel = (n: NivelApi) => ESTADOS[n].simbolo;

/** Tarjeta de un nodo: su semáforo, la frase de causa y acción (RF-20) y cuándo se supo algo de él. */
export function TarjetaNodo({
  nodo,
  ahora,
  conEnlace = true,
}: {
  nodo: NodoVista;
  ahora: number;
  /** El nombre lleva al detalle del nodo (no en el propio detalle). */
  conEnlace?: boolean;
}) {
  const { etiqueta, simbolo } = ESTADOS[nodo.visible];
  const parametro = nodo.parametroLimitante
    ? (NOMBRES_PARAMETRO[nodo.parametroLimitante] ?? nodo.parametroLimitante)
    : null;

  return (
    <article className={`nodo nivel-${nodo.visible}`} aria-label={nodo.nombre ?? "Nodo sin nombre"}>
      <h3>
        {conEnlace ? (
          <Link to={`/nodos/${nodo.id}`}>{nodo.nombre ?? "Nodo sin nombre"}</Link>
        ) : (
          (nodo.nombre ?? "Nodo sin nombre")
        )}
      </h3>
      <p className="semaforo">
        <span className="insignia">
          <span aria-hidden="true">{simbolo}</span> {etiqueta}
        </span>
      </p>

      {nodo.visible === "sin_conexion" && (
        <p className="detalle">
          {nodo.sinDatosDesde
            ? `Sin datos desde ${horaYDia(nodo.sinDatosDesde, ahora)}`
            : "Todavía no ha mandado datos."}
        </p>
      )}
      {nodo.visible !== "sin_conexion" && nodo.causa && <p className="causa">{nodo.causa}</p>}
      {nodo.visible !== "sin_conexion" && nodo.accion && <p className="accion">{nodo.accion}</p>}
      {nodo.sensorPorRevisar && nodo.visible !== "revisar" && (
        <p className="detalle">
          Revisa el sensor{parametro ? ` de ${parametro}` : ""}: puede estar fallando.
        </p>
      )}
      {nodo.visible !== "sin_conexion" && nodo.ultimaLecturaEn && (
        <p className="detalle">Última lectura {haceCuanto(nodo.ultimaLecturaEn, ahora)}</p>
      )}
    </article>
  );
}

export function AvisoFlujo({
  flujo,
}: {
  flujo: "conectando" | "en_vivo" | "reconectando" | "sin_acceso";
}) {
  if (flujo === "reconectando") {
    return (
      <p role="status" className="aviso">
        Reconectando… lo que ves puede no estar al día.
      </p>
    );
  }
  if (flujo === "sin_acceso") {
    return (
      <p role="alert">
        No pudimos mantener la conexión en vivo. Recarga la página para reintentar.
      </p>
    );
  }
  return null;
}
