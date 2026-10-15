import {
  type crearEspacioBody,
  crearInvitacionRespuesta,
  espacioApi,
  espacioDetalleApi,
  nodoApi,
  usuarioApi,
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

export function useEspacio(espacioId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["espacio", espacioId],
    queryFn: ({ signal }) =>
      api.pedir(`/api/espacios/${espacioId}`, { esquema: espacioDetalleApi, signal }),
    // un espacio ajeno o inexistente es un 404 definitivo: no se reintenta
    retry: (n, error) => n < 1 && (error as { status?: number }).status !== 404,
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
