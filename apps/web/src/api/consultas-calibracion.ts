import {
  calibracionApi,
  type EspacioApi,
  espacioDetalleApi,
  lecturaApi,
  listaCalibracionesRespuesta,
  type NodoApi,
  type ParametroCalibrableApi,
} from "@lympha/contracts";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useEspacios } from "./consultas.ts";
import { useApi } from "./contexto.ts";

const listaLecturas = z.object({ lecturas: z.array(lecturaApi) });

const sinReintentarSiNoExiste = (n: number, error: unknown) =>
  n < 1 && (error as { status?: number }).status !== 404;

/** Cada nodo de la persona con el espacio al que pertenece (de ahí sale su rol), para elegir cuál calibrar. */
export function useMisNodos() {
  const espacios = useEspacios();
  const api = useApi();
  const detalles = useQueries({
    queries: (espacios.data?.espacios ?? []).map((e) => ({
      queryKey: ["espacio", e.id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.pedir(`/api/espacios/${e.id}`, { esquema: espacioDetalleApi, signal }),
    })),
  });
  const nodos: { nodo: NodoApi; espacio: EspacioApi }[] = detalles.flatMap((d) =>
    d.data ? d.data.nodos.map((nodo) => ({ nodo, espacio: d.data.espacio })) : [],
  );
  return {
    nodos,
    cargando: espacios.isPending || detalles.some((d) => d.isPending),
    error: espacios.error ?? detalles.find((d) => d.error)?.error ?? null,
  };
}

/** Historial de calibraciones de un nodo (la más reciente primero). */
export function useCalibraciones(nodoId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["calibraciones", nodoId],
    queryFn: ({ signal }) =>
      api.pedir(`/api/calibraciones?nodo_id=${nodoId}&limite=100`, {
        esquema: listaCalibracionesRespuesta,
        signal,
      }),
    enabled: nodoId !== "",
    retry: sinReintentarSiNoExiste,
  });
}

/** Lecturas recientes pedidas cada pocos segundos: la estabilización se sigue en vivo durante la calibración. */
export function useLecturasVivas(nodoId: string, activa: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ["lecturas-vivas", nodoId],
    queryFn: ({ signal }) =>
      api.pedir(`/api/nodos/${nodoId}/lecturas?limite=60`, { esquema: listaLecturas, signal }),
    enabled: activa && nodoId !== "",
    refetchInterval: 3000,
    staleTime: 0,
    gcTime: 0,
    retry: sinReintentarSiNoExiste,
  });
}

export function useAccionesCalibracion(nodoId: string) {
  const api = useApi();
  const consultas = useQueryClient();
  const refrescar = () => {
    void consultas.invalidateQueries({ queryKey: ["calibraciones", nodoId] });
    void consultas.invalidateQueries({ queryKey: ["nodo", nodoId] });
    void consultas.invalidateQueries({ queryKey: ["espacio"] });
  };
  return {
    guardar: useMutation({
      mutationFn: (p: {
        parametro: ParametroCalibrableApi;
        puntos: { crudo: number; referencia: number }[];
      }) =>
        api.pedir("/api/calibraciones", {
          metodo: "POST",
          cuerpo: { nodo_id: nodoId, parametro: p.parametro, puntos: p.puntos },
          esquema: calibracionApi,
        }),
      onSuccess: refrescar,
    }),
    restablecer: useMutation({
      mutationFn: (parametro: ParametroCalibrableApi) =>
        api.pedir("/api/calibraciones/restablecer", {
          metodo: "POST",
          cuerpo: { nodo_id: nodoId, parametro },
          esquema: calibracionApi,
        }),
      onSuccess: refrescar,
    }),
    activar: useMutation({
      // POST sin cuerpo: el cliente no manda content-type
      mutationFn: (calibracionId: string) =>
        api.pedir(`/api/calibraciones/${calibracionId}/activar`, {
          metodo: "POST",
          esquema: calibracionApi,
        }),
      onSuccess: refrescar,
    }),
  };
}
