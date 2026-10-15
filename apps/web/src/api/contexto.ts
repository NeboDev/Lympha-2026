import { createContext, useContext } from "react";
import type { Cliente } from "./cliente.ts";

export const ContextoApi = createContext<Cliente | null>(null);

/** El cliente de la API de la aplicación (con la sesión). Solo dentro de `<App>`. */
export function useApi(): Cliente {
  const cliente = useContext(ContextoApi);
  if (!cliente) throw new Error("useApi fuera de <App>");
  return cliente;
}
