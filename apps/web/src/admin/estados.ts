import type { NodoAdminApi } from "@lympha/contracts";
import type { EstadoVisible } from "../espacios/estado.ts";

type EstadoNodo = NodoAdminApi["estado"];

/** Texto y símbolo de cada estado de un nodo en el panel (el símbolo sale de `Insignia`; el color nunca va solo). */
export const ESTADO_NODO: Record<EstadoNodo, { texto: string; visible: EstadoVisible }> = {
  fabricado: { texto: "Fabricado · sin reclamar", visible: "sin_vincular" },
  reclamado: { texto: "Reclamado", visible: "esperando" },
  activo: { texto: "Activo", visible: "buena" },
  desvinculado: { texto: "Desvinculado", visible: "sin_datos" },
  revocado: { texto: "Deshabilitado (revocado)", visible: "deshabilitado" },
};

export const ESTADOS_NODO = Object.keys(ESTADO_NODO) as EstadoNodo[];

export const fechaCorta = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString("es-MX", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/Mexico_City",
      })
    : "—";
