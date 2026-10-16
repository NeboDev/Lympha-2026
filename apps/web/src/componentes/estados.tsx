import type { ComponentType } from "react";
import type { EstadoVisible } from "../espacios/estado.ts";
import {
  IcoAlerta,
  IcoCheck,
  IcoLlave,
  IcoMenos,
  IcoOctagono,
  IcoReloj,
  IcoSinRed,
  type PropsIcono,
} from "./Iconos.tsx";

/** Un símbolo propio por estado: el color del semáforo nunca es lo único que lo distingue. */
export const ICONO_ESTADO: Record<EstadoVisible, ComponentType<PropsIcono>> = {
  buena: IcoCheck,
  regular: IcoMenos,
  mala: IcoAlerta,
  critica: IcoOctagono,
  sin_datos: IcoReloj,
  revisar: IcoLlave,
  sin_conexion: IcoSinRed,
  esperando: IcoReloj,
  deshabilitado: IcoMenos,
  sin_vincular: IcoMenos,
};

/** Chip de estado: relleno de semáforo, texto oscuro, símbolo y palabra. */
export function Insignia({
  estado,
  texto,
  grande = false,
}: {
  estado: EstadoVisible;
  texto: string;
  grande?: boolean;
}) {
  const Icono = ICONO_ESTADO[estado];
  return (
    <span className={`insignia nivel-${estado}${grande ? " grande" : ""}`}>
      <Icono tamano={grande ? 18 : 15} grosor={2.6} />
      <span>{texto}</span>
    </span>
  );
}

/**
 * Anillo del estado. El arco va completo y del color del nivel; adentro, el símbolo del nivel.
 * No muestra el número del WQI: el nivel del semáforo sigue una histéresis y el número puede ir por delante
 * (el índice solo se ve en el detalle, con su explicación).
 */
export function Anillo({ estado, tamano = 76 }: { estado: EstadoVisible; tamano?: number }) {
  const Icono = ICONO_ESTADO[estado];
  const punteado = estado === "sin_conexion" || estado === "esperando" || estado === "sin_datos";
  return (
    <span
      className={`nivel-${estado} relative grid shrink-0 place-items-center rounded-full text-text`}
      style={{ width: tamano, height: tamano }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 100" width={tamano} height={tamano} className="absolute inset-0">
        <circle cx="50" cy="50" r="38" fill="var(--tinte)" />
        <circle
          cx="50"
          cy="50"
          r="44"
          fill="none"
          stroke="var(--fondo)"
          strokeWidth={punteado ? 4 : 10}
          strokeDasharray={punteado ? "0.1 8.4" : undefined}
          strokeLinecap="round"
        />
      </svg>
      <Icono tamano={Math.round(tamano * 0.38)} grosor={2.4} className="relative" />
    </span>
  );
}
