import type { NivelApi } from "@lympha/contracts";
import { Link } from "react-router";
import { InsigniaCalibracion } from "../calibracion/InsigniaCalibracion.tsx";
import type { EstadoVisible, NodoVista } from "../espacios/estado.ts";
import { haceCuanto, horaYDia } from "../espacios/tiempo.ts";
import { Anillo, Insignia } from "./estados.tsx";
import { IcoFoco, IcoReloj, IcoSinRed } from "./Iconos.tsx";

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
  grande = false,
}: {
  nodo: NodoVista;
  ahora: number;
  /** El nombre lleva al detalle del nodo (no en el propio detalle). */
  conEnlace?: boolean;
  /** Versión del detalle del nodo: anillo grande y la acción como bloque «Qué hacer». */
  grande?: boolean;
}) {
  const { etiqueta } = ESTADOS[nodo.visible];
  const parametro = nodo.parametroLimitante
    ? (NOMBRES_PARAMETRO[nodo.parametroLimitante] ?? nodo.parametroLimitante)
    : null;

  return (
    <article
      className={`nodo nivel-${nodo.visible} relative flex gap-4 rounded-card border border-line p-4 shadow-1 transition-shadow duration-200 hover:shadow-2`}
      aria-label={nodo.nombre ?? "Nodo sin nombre"}
    >
      <Anillo estado={nodo.visible} tamano={grande ? 112 : 76} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <h3
            className={`m-0 min-w-0 font-semibold text-text-2 ${grande ? "text-base" : "text-sm"}`}
          >
            {conEnlace ? (
              <Link
                to={`/nodos/${nodo.id}`}
                className="text-inherit no-underline after:absolute after:inset-0 after:rounded-card hover:underline"
              >
                {nodo.nombre ?? "Nodo sin nombre"}
              </Link>
            ) : (
              (nodo.nombre ?? "Nodo sin nombre")
            )}
          </h3>
          {nodo.visible !== "sin_conexion" && nodo.ultimaLecturaEn && (
            <p className="m-0 inline-flex shrink-0 items-center gap-1 text-xs text-text-2 tabular-nums">
              <IcoReloj tamano={13} />
              <span className="sr-only">Última lectura </span>
              <span>{haceCuanto(nodo.ultimaLecturaEn, ahora)}</span>
            </p>
          )}
        </div>

        {nodo.visible !== "sin_conexion" && nodo.causa && (
          <p className={`causa m-0 leading-snug font-bold ${grande ? "text-xl" : "text-lg"}`}>
            {nodo.causa}
          </p>
        )}
        {nodo.visible !== "sin_conexion" &&
          nodo.accion &&
          (grande ? (
            <div className="mt-1 rounded-ctl border border-line bg-surface/70 p-3">
              <p className="m-0 mb-1 inline-flex items-center gap-1.5 text-sm font-bold text-text-2">
                <IcoFoco tamano={16} /> Qué hacer
              </p>
              <p className="accion m-0 font-semibold">{nodo.accion}</p>
            </div>
          ) : (
            <p className="accion m-0 text-sm font-semibold">{nodo.accion}</p>
          ))}
        {nodo.visible === "sin_conexion" && (
          <p className="detalle m-0">
            {nodo.sinDatosDesde
              ? `Sin datos desde ${horaYDia(nodo.sinDatosDesde, ahora)}`
              : "Todavía no ha mandado datos."}
          </p>
        )}
        {nodo.sensorPorRevisar && nodo.visible !== "revisar" && (
          <p className="detalle m-0">
            Revisa el sensor{parametro ? ` de ${parametro}` : ""}: puede estar fallando.
          </p>
        )}
        <p className="semaforo m-0 mt-1">
          <Insignia estado={nodo.visible} texto={etiqueta} />
        </p>
        {nodo.calibracion && (
          <p className="relative m-0">
            <InsigniaCalibracion resumen={nodo.calibracion} ahora={ahora} />
            {nodo.calibracion.estado !== "vigente" && (
              <Link to={`/calibracion?nodo=${nodo.id}`} className="ml-2 text-sm font-semibold">
                Calibrar
              </Link>
            )}
          </p>
        )}
      </div>
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
        <IcoSinRed tamano={16} className="mr-1.5 inline align-[-3px]" />
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
