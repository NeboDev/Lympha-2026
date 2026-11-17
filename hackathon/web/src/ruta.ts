import { useCallback, useEffect, useState } from "react";

/** Tres pantallas dentro de la sesión. Un enrutador de una línea: no hace falta una librería. */
export type Ruta = "agua" | "reportes" | "comunidad";

export const RUTAS: readonly Ruta[] = ["agua", "reportes", "comunidad"];

/** «#/reportes» → «reportes»; cualquier otra cosa → «agua». */
export function leerRuta(hash: string): Ruta {
  const nombre = hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  return RUTAS.find((r) => r === nombre) ?? "agua";
}

export function useRuta(): [Ruta, (r: Ruta) => void] {
  const [ruta, setRuta] = useState<Ruta>(() => leerRuta(window.location.hash));
  useEffect(() => {
    const alCambiar = () => setRuta(leerRuta(window.location.hash));
    window.addEventListener("hashchange", alCambiar);
    return () => window.removeEventListener("hashchange", alCambiar);
  }, []);
  const ir = useCallback((r: Ruta) => {
    window.location.hash = `#/${r}`;
  }, []);
  return [ruta, ir];
}
