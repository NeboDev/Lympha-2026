import type { ObjectId } from "mongodb";
import type { Rol } from "../../dominio/errores.ts";

export type TipoComunidad = "escuela" | "comite" | "hogar" | "otro";
export const TIPOS_COMUNIDAD: readonly TipoComunidad[] = ["escuela", "comite", "hogar", "otro"];

export type ComunidadDoc = {
  _id: ObjectId;
  nombre: string;
  tipo: TipoComunidad;
  /** `uid` es el de Firebase. */
  miembros: { uid: string; rol: Rol }[];
  /** El chat vinculado. Los ids del chat y de quien lo vinculó nunca salen por la API. */
  telegram?: { chat_id: number; titulo: string | null; vinculado: Date } | null;
  creado: Date;
};

export interface AlmacenComunidades {
  insertar(comunidad: ComunidadDoc): Promise<void>;
  obtener(id: ObjectId): Promise<ComunidadDoc | null>;
  /** Las comunidades de las que la persona es miembro, por nombre. */
  deUsuario(uid: string): Promise<ComunidadDoc[]>;
  /** Cuántas comunidades tiene la persona como responsable (para ponerle un tope). */
  contarResponsable(uid: string): Promise<number>;
}

/** Lo que la API muestra de una comunidad. */
export type ComunidadVista = {
  id: string;
  nombre: string;
  tipo: TipoComunidad;
  /** El rol de quien consulta. */
  rol: Rol;
  telegram: { vinculado: true; titulo: string | null } | null;
  creado: Date;
};
