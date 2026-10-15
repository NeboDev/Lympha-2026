import {
  alarmaApi,
  type crearEspacioBody,
  crearInvitacionRespuesta,
  espacioApi,
  espacioDetalleApi,
  estadoTelegramApi,
  lecturaApi,
  listaAlarmasRespuesta,
  nodoApi,
  type PreferenciaNotificacion,
  preferenciasRespuesta,
  respuestaHistorial,
  usuarioApi,
  vinculoTelegramRespuesta,
} from "@lympha/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useApi } from "./contexto.ts";

const listaEspacios = z.object({ espacios: z.array(espacioApi) });
const aceptada = z.object({ espacio_id: z.string().uuid() });

type NuevoEspacio = z.infer<typeof crearEspacioBody>;

/** La persona en sesión (su `id` sirve para reconocerse en la lista de miembros). */
export function useYo() {
  const api = useApi();
  return useQuery({
    queryKey: ["yo"],
    queryFn: ({ signal }) => api.pedir("/api/yo", { esquema: usuarioApi, signal }),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useEspacios() {
  const api = useApi();
  return useQuery({
    queryKey: ["espacios"],
    queryFn: ({ signal }) => api.pedir("/api/espacios", { esquema: listaEspacios, signal }),
  });
}

/** `espacioId` vacío = sin consulta (p. ej. un nodo desvinculado no tiene espacio). */
export function useEspacio(espacioId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["espacio", espacioId],
    queryFn: ({ signal }) =>
      api.pedir(`/api/espacios/${espacioId}`, { esquema: espacioDetalleApi, signal }),
    enabled: espacioId !== "",
    // un espacio ajeno o inexistente es un 404 definitivo: no se reintenta
    retry: (n, error) => n < 1 && (error as { status?: number }).status !== 404,
  });
}

const sinReintentarSiNoExiste = (n: number, error: unknown) =>
  n < 1 && (error as { status?: number }).status !== 404;

export function useNodo(nodoId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["nodo", nodoId],
    queryFn: ({ signal }) => api.pedir(`/api/nodos/${nodoId}`, { esquema: nodoApi, signal }),
    retry: sinReintentarSiNoExiste,
  });
}

const listaLecturas = z.object({ lecturas: z.array(lecturaApi) });

/** Las últimas lecturas del nodo (la API las da de la más reciente a la más antigua). Solo si `activa`. */
export function useLecturas(nodoId: string, limite: number, activa: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ["lecturas", nodoId, limite],
    queryFn: ({ signal }) =>
      api.pedir(`/api/nodos/${nodoId}/lecturas?limite=${limite}`, {
        esquema: listaLecturas,
        signal,
      }),
    enabled: activa,
    refetchInterval: 30_000,
    retry: sinReintentarSiNoExiste,
  });
}

/** Alarmas de un espacio (RF-32): `abiertas` (activas y atendidas) o todas, con su historial. */
export function useAlarmas(espacioId: string, estado: "abiertas" | "todas") {
  const api = useApi();
  return useQuery({
    queryKey: ["alarmas", espacioId, estado],
    queryFn: ({ signal }) =>
      api.pedir(
        `/api/espacios/${espacioId}/alarmas?limite=${estado === "todas" ? 100 : 50}${estado === "abiertas" ? "&estado=abiertas" : ""}`,
        { esquema: listaAlarmasRespuesta, signal },
      ),
    enabled: espacioId !== "",
    retry: sinReintentarSiNoExiste,
  });
}

/** Marcar una alarma como atendida. Refresca las alertas de su espacio. */
export function useAtenderAlarma() {
  const api = useApi();
  const consultas = useQueryClient();
  return useMutation({
    // POST sin cuerpo: el cliente no manda content-type
    mutationFn: (alarmaId: string) =>
      api.pedir(`/api/alarmas/${alarmaId}/atender`, { metodo: "POST", esquema: alarmaApi }),
    onSettled: (_r, _e, _id) => {
      // también tras un 409 (otra persona la atendió primero): hay que ver el estado real
      void consultas.invalidateQueries({ queryKey: ["alarmas"] });
    },
  });
}

/** Estado del vínculo de Telegram de la persona. `sondear` lo vuelve a pedir cada pocos segundos (mientras se vincula). */
export function useTelegram(sondear = false) {
  const api = useApi();
  return useQuery({
    queryKey: ["telegram"],
    queryFn: ({ signal }) => api.pedir("/api/yo/telegram", { esquema: estadoTelegramApi, signal }),
    refetchInterval: sondear ? 3000 : false,
  });
}

export function useAccionesTelegram() {
  const api = useApi();
  const consultas = useQueryClient();
  return {
    vincular: useMutation({
      mutationFn: () =>
        api.pedir("/api/yo/telegram/vinculo", {
          metodo: "POST",
          esquema: vinculoTelegramRespuesta,
        }),
    }),
    desvincular: useMutation({
      mutationFn: () => api.pedir("/api/yo/telegram", { metodo: "DELETE" }),
      onSuccess: () => void consultas.invalidateQueries({ queryKey: ["telegram"] }),
    }),
  };
}

/** Preferencias de aviso (RF-31): la general y las de cada nodo que se personalizó. */
export function usePreferencias() {
  const api = useApi();
  return useQuery({
    queryKey: ["preferencias"],
    queryFn: ({ signal }) =>
      api.pedir("/api/yo/notificaciones", { esquema: preferenciasRespuesta, signal }),
  });
}

export function useAccionesPreferencias() {
  const api = useApi();
  const consultas = useQueryClient();
  const refrescar = () => void consultas.invalidateQueries({ queryKey: ["preferencias"] });
  return {
    guardar: useMutation({
      mutationFn: (preferencia: PreferenciaNotificacion) =>
        api.pedir("/api/yo/notificaciones", {
          metodo: "PUT",
          cuerpo: preferencia,
          esquema: preferenciasRespuesta,
        }),
      onSuccess: refrescar,
    }),
    quitarDeNodo: useMutation({
      mutationFn: (nodoId: string) =>
        api.pedir(`/api/yo/notificaciones/${nodoId}`, { metodo: "DELETE" }),
      onSuccess: refrescar,
    }),
  };
}

/** Historial diario de 7 o 30 días (RF-35). */
export function useHistorial(nodoId: string, dias: 7 | 30) {
  const api = useApi();
  return useQuery({
    queryKey: ["historial", nodoId, dias],
    queryFn: ({ signal }) =>
      api.pedir(`/api/nodos/${nodoId}/historial?dias=${dias}`, {
        esquema: respuestaHistorial,
        signal,
      }),
    staleTime: 60_000,
    retry: sinReintentarSiNoExiste,
  });
}

/** Mutaciones de espacios, miembros e invitaciones. Todas refrescan lo que cambian. */
export function useAccionesEspacio() {
  const api = useApi();
  const consultas = useQueryClient();
  const refrescar = (espacioId?: string) => {
    void consultas.invalidateQueries({ queryKey: ["espacios"] });
    if (espacioId) void consultas.invalidateQueries({ queryKey: ["espacio", espacioId] });
  };

  return {
    crear: useMutation({
      mutationFn: (cuerpo: NuevoEspacio) =>
        api.pedir("/api/espacios", { metodo: "POST", cuerpo, esquema: espacioApi }),
      onSuccess: () => refrescar(),
    }),

    editar: useMutation({
      mutationFn: (p: { espacioId: string; nombre?: string; tipo?: NuevoEspacio["tipo"] }) =>
        api.pedir(`/api/espacios/${p.espacioId}`, {
          metodo: "PATCH",
          cuerpo: {
            ...(p.nombre ? { nombre: p.nombre } : {}),
            ...(p.tipo ? { tipo: p.tipo } : {}),
          },
          esquema: espacioApi,
        }),
      onSuccess: (_r, p) => refrescar(p.espacioId),
    }),

    invitar: useMutation({
      // POST sin cuerpo: el cliente no manda content-type (Fastify respondería 400)
      mutationFn: (espacioId: string) =>
        api.pedir(`/api/espacios/${espacioId}/invitaciones`, {
          metodo: "POST",
          esquema: crearInvitacionRespuesta,
        }),
    }),

    aceptarInvitacion: useMutation({
      mutationFn: (token: string) =>
        api.pedir("/api/invitaciones/aceptar", {
          metodo: "POST",
          cuerpo: { token },
          esquema: aceptada,
        }),
      onSuccess: () => refrescar(),
    }),

    quitarMiembro: useMutation({
      mutationFn: (p: { espacioId: string; usuarioId: string }) =>
        api.pedir(`/api/espacios/${p.espacioId}/miembros/${p.usuarioId}`, { metodo: "DELETE" }),
      onSuccess: (_r, p) => refrescar(p.espacioId),
    }),

    transferir: useMutation({
      mutationFn: (p: { espacioId: string; usuarioId: string }) =>
        api.pedir(`/api/espacios/${p.espacioId}/transferir`, {
          metodo: "POST",
          cuerpo: { usuarioId: p.usuarioId },
        }),
      onSuccess: (_r, p) => refrescar(p.espacioId),
    }),

    reclamarNodo: useMutation({
      mutationFn: async (p: {
        espacioId: string;
        nodoId: string;
        codigo: string;
        nombre?: string;
      }) => {
        const nodo = await api.pedir("/api/nodos/reclamar", {
          metodo: "POST",
          cuerpo: { nodoId: p.nodoId, codigo: p.codigo, espacioId: p.espacioId },
          esquema: nodoApi,
        });
        if (!p.nombre) return nodo;
        // El nodo ya es del espacio; si poner el nombre falla, el reclamo no se deshace: queda sin nombre.
        return api
          .pedir(`/api/nodos/${nodo.id}`, {
            metodo: "PATCH",
            cuerpo: { nombre: p.nombre },
            esquema: nodoApi,
          })
          .catch(() => nodo);
      },
      onSuccess: (_r, p) => refrescar(p.espacioId),
    }),
  };
}
