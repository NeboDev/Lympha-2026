import { type ReactNode, useEffect, useState } from "react";
import logo from "../assets/lympha-logo.svg";
import logoOscuro from "../assets/lympha-logo-oscuro.svg";
import simbolo from "../assets/lympha-simbolo.svg";
import simboloOscuro from "../assets/lympha-simbolo-oscuro.svg";
import { haceLegible } from "../util/formato.ts";
import { ESTADOS_UI, type EstadoVisual } from "./estados.ts";
import { Icono } from "./Iconos.tsx";

/**
 * Marca de Lympha. «simbolo» es solo el isotipo (decorativo: el nombre va al lado en texto); «logo» es el símbolo con
 * el nombre y sí lleva texto alternativo. Cada uno trae su variante para fondo oscuro, que sigue al tema del sistema.
 */
export function Marca({
  variante = "simbolo",
  ancho,
}: {
  variante?: "simbolo" | "logo";
  ancho: number;
}) {
  const [claro, oscuro, proporcion] =
    variante === "logo" ? [logo, logoOscuro, 786 / 960] : [simbolo, simboloOscuro, 534 / 640];
  return (
    <picture>
      <source media="(prefers-color-scheme: dark)" srcSet={oscuro} />
      <img
        className="marca-img"
        src={claro}
        alt=""
        width={ancho}
        height={Math.round(ancho * proporcion)}
        decoding="async"
      />
    </picture>
  );
}

/** Estado del agua: color + símbolo + palabra. Nunca solo color. */
export function Insignia({ estado, grande = false }: { estado: EstadoVisual; grande?: boolean }) {
  const e = ESTADOS_UI[estado];
  return (
    <span
      className={grande ? "insignia insignia-grande" : "insignia"}
      style={{ background: e.color }}
    >
      <Icono nombre={e.icono} tamano={grande ? 24 : 18} />
      <span>{e.palabra}</span>
    </span>
  );
}

/** Un error de una consulta que aún no tiene datos, con la salida obvia: intentar de nuevo. */
export function ErrorConReintento({
  error,
  alReintentar,
}: {
  error: string;
  alReintentar: () => void;
}) {
  return (
    <Aviso
      tipo="error"
      accion={
        <button type="button" className="boton boton-secundario boton-chico" onClick={alReintentar}>
          Intentar de nuevo
        </button>
      }
    >
      {error}
    </Aviso>
  );
}

export function Cargando({ texto = "Cargando…" }: { texto?: string }) {
  return (
    <p className="cargando" role="status">
      {texto}
    </p>
  );
}

/** Un aviso con qué pasó y qué hacer. `error` suena a alerta para los lectores de pantalla. */
export function Aviso({
  tipo = "info",
  children,
  accion,
}: {
  tipo?: "info" | "error";
  children: ReactNode;
  accion?: ReactNode;
}) {
  return (
    <div className={`aviso aviso-${tipo}`} role={tipo === "error" ? "alert" : "status"}>
      <p>{children}</p>
      {accion}
    </div>
  );
}

export function Vacio({
  titulo,
  children,
  accion,
}: {
  titulo: string;
  children?: ReactNode;
  accion?: ReactNode;
}) {
  return (
    <div className="vacio">
      <h3>{titulo}</h3>
      {children ? <p>{children}</p> : null}
      {accion}
    </div>
  );
}

/** Un reloj que avanza solo: para «hace 4 s» sin pedir nada al servidor. */
export function useAhora(cadaMs = 1000): Date {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), cadaMs);
    return () => clearInterval(t);
  }, [cadaMs]);
  return ahora;
}

export function Hace({ fecha }: { fecha: Date }) {
  const ahora = useAhora();
  return <>{haceLegible((ahora.getTime() - fecha.getTime()) / 1000)}</>;
}
