import { useCallback, useEffect, useRef, useState } from "react";
import { mensajeDeError } from "./mensajes.ts";

export type Consulta<T> = {
  datos: T | null;
  /** Mensaje para la persona, o `null`. Con datos previos, la pantalla sigue mostrándolos junto al aviso. */
  error: string | null;
  /** `true` solo mientras llega la primera respuesta (o tras cambiar de nodo): las recargas no parpadean. */
  cargando: boolean;
  /** Cuándo llegó la última respuesta buena. */
  actualizado: Date | null;
  recargar(): void;
};

type Opciones = {
  /** Cada cuántos ms se vuelve a pedir. Sin esto, solo se pide al cambiar `deps` o con `recargar()`. */
  cadaMs?: number;
  /** `false` no pide nada (p. ej. todavía no hay un nodo elegido). */
  activa?: boolean;
};

/**
 * Pide datos a la API y, si se pide, los refresca cada cierto tiempo. Se pausa con la pestaña oculta (no
 * gasta batería ni cuota de Blynk) y al volver pide de inmediato. Cancela lo que quede en vuelo al cambiar.
 */
export function useConsulta<T>(
  cargar: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  opciones: Opciones = {},
): Consulta<T> {
  const { cadaMs, activa = true } = opciones;
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(activa);
  const [actualizado, setActualizado] = useState<Date | null>(null);
  const [version, setVersion] = useState(0);
  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `deps` y `version` son los disparadores a propósito
  useEffect(() => {
    if (!activa) {
      setDatos(null);
      setError(null);
      setCargando(false);
      return;
    }
    const control = new AbortController();
    let vivo = true;
    // Al cambiar de nodo o de periodo no se muestran datos del anterior.
    setDatos(null);
    setError(null);
    setCargando(true);

    async function pedir() {
      try {
        const r = await cargarRef.current(control.signal);
        if (!vivo) return;
        setDatos(r);
        setError(null);
        setActualizado(new Date());
      } catch (e) {
        if (!vivo || (e instanceof DOMException && e.name === "AbortError")) return;
        setError(mensajeDeError(e));
      } finally {
        if (vivo) setCargando(false);
      }
    }

    void pedir();
    let reloj: ReturnType<typeof setInterval> | undefined;
    const alVolver = () => {
      if (!document.hidden) void pedir();
    };
    if (cadaMs) {
      reloj = setInterval(() => {
        if (!document.hidden) void pedir();
      }, cadaMs);
      document.addEventListener("visibilitychange", alVolver);
    }
    return () => {
      vivo = false;
      control.abort();
      if (reloj) clearInterval(reloj);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [...deps, version, activa, cadaMs]);

  const recargar = useCallback(() => setVersion((v) => v + 1), []);
  return { datos, error, cargando, actualizado, recargar };
}
