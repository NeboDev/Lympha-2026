import type { NodoApi, RolEspacio, TipoEspacio } from "@lympha/contracts";

export const TIPOS_ESPACIO: { valor: TipoEspacio; etiqueta: string }[] = [
  { valor: "hogar", etiqueta: "Hogar" },
  { valor: "escuela", etiqueta: "Escuela" },
  { valor: "pyme", etiqueta: "Negocio" },
  { valor: "hotel", etiqueta: "Hotel" },
  { valor: "otro", etiqueta: "Otro" },
];

export const etiquetaTipo = (tipo: TipoEspacio) =>
  TIPOS_ESPACIO.find((t) => t.valor === tipo)?.etiqueta ?? tipo;

export const etiquetaRol = (rol: RolEspacio) => (rol === "propietario" ? "Propietario" : "Miembro");

/** Estado del ciclo de vida del nodo, en palabras de la persona (el semáforo de calidad llega en otro paso). */
export function etiquetaEstadoNodo(nodo: NodoApi): string {
  switch (nodo.estado) {
    case "reclamado":
      return "Esperando la primera lectura";
    case "activo":
      return nodo.estado_actual?.conectado ? "En línea" : "Sin conexión";
    case "revocado":
      return "Dispositivo deshabilitado";
    default:
      return "Sin vincular";
  }
}
