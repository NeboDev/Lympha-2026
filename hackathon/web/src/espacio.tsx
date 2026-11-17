import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import {
  type Comunidad,
  listaNodos,
  type Nodo,
  type RespuestaYo,
  respuestaYo,
} from "./api/tipos.ts";
import { type Consulta, useConsulta } from "./api/use-consulta.ts";
import { useSesion } from "./sesion/contexto.tsx";

/**
 * Dónde está la persona: su comunidad y su nodo elegidos. Lo eligen las pantallas (selector de la barra) y se
 * recuerda en este dispositivo. Todo lo que muestra la web sale de aquí o de pedidos por nodo.
 */
export type Espacio = {
  yo: Consulta<RespuestaYo>;
  comunidad: Comunidad | null;
  nodos: Consulta<Nodo[]>;
  nodo: Nodo | null;
  elegirComunidad(id: string): void;
  elegirNodo(id: string): void;
  /** Vuelve a pedir la persona y sus nodos (tras crear una comunidad o dar de alta un nodo). */
  recargar(): void;
};

const Contexto = createContext<Espacio | null>(null);

const CLAVE_COMUNIDAD = "atl.comunidad";
const CLAVE_NODO = "atl.nodo";

/** Preferencias de este dispositivo. `localStorage` puede fallar: la web funciona igual sin él. */
const leer = (clave: string): string | null => {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
};
const guardar = (clave: string, valor: string) => {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    // Sin almacenamiento solo se pierde recordar la elección.
  }
};

export function ProveedorEspacio({ children }: { children: ReactNode }) {
  const { api } = useSesion();
  const [comunidadId, setComunidadId] = useState<string | null>(() => leer(CLAVE_COMUNIDAD));
  const [nodoId, setNodoId] = useState<string | null>(() => leer(CLAVE_NODO));

  const yo = useConsulta((signal) => api.pedir("/api/yo", { esquema: respuestaYo, signal }), [api]);
  const comunidades = yo.datos?.comunidades ?? [];
  const comunidad = comunidades.find((c) => c.id === comunidadId) ?? comunidades[0] ?? null;

  const nodos = useConsulta(
    async (signal) =>
      (await api.pedir(`/api/comunidades/${comunidad?.id}/nodos`, { esquema: listaNodos, signal }))
        .nodos,
    [api, comunidad?.id],
    // Se refresca solo: la lista de nodos muestra el estado de cada uno y no debe quedarse vieja.
    { activa: comunidad !== null, cadaMs: 15_000 },
  );
  const lista = nodos.datos ?? [];
  const nodo = lista.find((n) => n.id === nodoId) ?? lista[0] ?? null;

  const elegirComunidad = useCallback((id: string) => {
    setComunidadId(id);
    guardar(CLAVE_COMUNIDAD, id);
  }, []);
  const elegirNodo = useCallback((id: string) => {
    setNodoId(id);
    guardar(CLAVE_NODO, id);
  }, []);
  const recargarYo = yo.recargar;
  const recargarNodos = nodos.recargar;
  const recargar = useCallback(() => {
    recargarYo();
    recargarNodos();
  }, [recargarYo, recargarNodos]);

  const valor = useMemo<Espacio>(
    () => ({ yo, comunidad, nodos, nodo, elegirComunidad, elegirNodo, recargar }),
    [yo, comunidad, nodos, nodo, elegirComunidad, elegirNodo, recargar],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useEspacio(): Espacio {
  const e = useContext(Contexto);
  if (!e) throw new Error("useEspacio debe usarse dentro de <ProveedorEspacio>");
  return e;
}
