import {
  type CrearLoteBody,
  listaLotesAdminRespuesta,
  listaNodosAdminRespuesta,
  loteCreadoRespuesta,
  nodoAdminDetalleApi,
  perteneceARespuesta,
  regenerarEtiquetaRespuesta,
  revocarLoteRespuesta,
} from "@lympha/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "./contexto.ts";

export interface FiltrosNodosAdmin {
  lote: string;
  estado: string;
  q: string;
  pagina: number;
}
export const POR_PAGINA = 25;

/** Lotes de la plataforma. Solo existe para quien es admin de plataforma (para los demás la API da 404). */
export function useLotesAdmin() {
  const api = useApi();
  return useQuery({
    queryKey: ["admin", "lotes"],
    queryFn: ({ signal }) =>
      api.pedir("/api/admin/lotes", { esquema: listaLotesAdminRespuesta, signal }),
    retry: false,
  });
}

export function useNodosAdmin(f: FiltrosNodosAdmin) {
  const api = useApi();
  return useQuery({
    queryKey: ["admin", "nodos", f],
    queryFn: ({ signal }) => {
      const p = new URLSearchParams({
        limite: String(POR_PAGINA),
        desplazamiento: String(f.pagina * POR_PAGINA),
      });
      if (f.lote) p.set("lote", f.lote);
      if (f.estado) p.set("estado", f.estado);
      if (f.q.trim()) p.set("q", f.q.trim());
      return api.pedir(`/api/admin/nodos?${p}`, { esquema: listaNodosAdminRespuesta, signal });
    },
    placeholderData: (anterior) => anterior,
    retry: false,
  });
}

export function useNodoAdmin(nodoId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["admin", "nodo", nodoId],
    queryFn: ({ signal }) =>
      api.pedir(`/api/admin/nodos/${nodoId}`, { esquema: nodoAdminDetalleApi, signal }),
    retry: false,
  });
}

export function useAccionesAdmin() {
  const api = useApi();
  const consultas = useQueryClient();
  const refrescar = () => void consultas.invalidateQueries({ queryKey: ["admin"] });

  return {
    // Las dos primeras llevan secretos en claro: gcTime 0 para que no se queden en la caché de consultas.
    crearLote: useMutation({
      mutationFn: (cuerpo: CrearLoteBody) =>
        api.pedir("/api/admin/lotes", { metodo: "POST", cuerpo, esquema: loteCreadoRespuesta }),
      onSuccess: refrescar,
      gcTime: 0,
    }),
    regenerar: useMutation({
      mutationFn: (nodoId: string) =>
        api.pedir(`/api/admin/nodos/${nodoId}/regenerar-etiqueta`, {
          metodo: "POST",
          esquema: regenerarEtiquetaRespuesta,
        }),
      onSuccess: refrescar,
      gcTime: 0,
    }),
    revocarNodo: useMutation({
      mutationFn: (nodoId: string) =>
        api.pedir(`/api/admin/nodos/${nodoId}/revocar`, {
          metodo: "POST",
          cuerpo: { confirmar: true },
        }),
      onSuccess: refrescar,
    }),
    revocarLote: useMutation({
      mutationFn: (loteId: string) =>
        api.pedir(`/api/admin/lotes/${loteId}/revocar`, {
          metodo: "POST",
          cuerpo: { confirmar: true },
          esquema: revocarLoteRespuesta,
        }),
      onSuccess: refrescar,
    }),
    // Cada llamada queda registrada en la auditoría: es una acción, no una consulta que se cachea.
    perteneceA: useMutation({
      mutationFn: (nodoId: string) =>
        api.pedir(`/api/admin/nodos/${nodoId}/pertenece-a`, { esquema: perteneceARespuesta }),
      gcTime: 0,
    }),
  };
}
