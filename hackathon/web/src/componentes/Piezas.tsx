import { type ReactNode, useEffect, useState } from "react";
import { haceLegible } from "../util/formato.ts";
import { ESTADOS_UI, type EstadoVisual } from "./estados.ts";
import { Icono } from "./Iconos.tsx";

/** Símbolo de Atl (gota Talavera con anillo y destello). Boceto de hackathon: design/logo-atl.svg. */
export function Marca({ tamano = 32 }: { tamano?: number }) {
  return (
    <svg width={tamano} height={tamano} viewBox="0 0 64 64" role="img" aria-label="Atl">
      <path d="M32 4C32 4 12 26 12 40a20 20 0 0 0 40 0C52 26 32 4 32 4Z" fill="var(--talavera)" />
      <circle cx="32" cy="40" r="11" fill="none" stroke="var(--bg)" strokeWidth="2.5" />
      <circle cx="32" cy="40" r="4" fill="var(--agua)" />
      <path
        d="M21 36c1-4 4-8 7-11"
        fill="none"
        stroke="var(--agua)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
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
