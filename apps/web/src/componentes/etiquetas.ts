import type { RolEspacio, TipoEspacio } from "@lympha/contracts";

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
