import { ObjectId } from "mongodb";
import {
  Conflicto,
  NoEncontrado,
  puedeComo,
  type Rol,
  SinPermiso,
  SolicitudInvalida,
} from "../../dominio/errores.ts";
import type { AlmacenComunidades, ComunidadDoc, ComunidadVista, TipoComunidad } from "./puertos.ts";

export type OpcionesComunidades = {
  almacen: AlmacenComunidades;
  reloj?: () => Date;
};

/** Tope por persona: evita llenar la base de comunidades vacías. */
export const MAX_COMUNIDADES_RESPONSABLE = 10;
export const NOMBRE_MAX = 80;

export function vistaDeComunidad(c: ComunidadDoc, rol: Rol): ComunidadVista {
  return {
    id: c._id.toHexString(),
    nombre: c.nombre,
    tipo: c.tipo,
    rol,
    telegram: c.telegram ? { vinculado: true, titulo: c.telegram.titulo } : null,
    creado: c.creado,
  };
}

export function crearServicioComunidades(op: OpcionesComunidades) {
  const reloj = op.reloj ?? (() => new Date());

  const rolDe = (c: ComunidadDoc, uid: string): Rol | null =>
    c.miembros.find((m) => m.uid === uid)?.rol ?? null;

  const servicio = {
    /** Crea una comunidad; quien la crea queda como su responsable. */
    async crear(
      uid: string,
      datos: { nombre: string; tipo: TipoComunidad },
    ): Promise<ComunidadVista> {
      const nombre = datos.nombre.trim();
      if (nombre.length < 2 || nombre.length > NOMBRE_MAX) {
        throw new SolicitudInvalida(
          "nombre_invalido",
          `El nombre debe tener de 2 a ${NOMBRE_MAX} caracteres.`,
        );
      }
      if ((await op.almacen.contarResponsable(uid)) >= MAX_COMUNIDADES_RESPONSABLE) {
        throw new Conflicto(
          "demasiadas_comunidades",
          `Ya eres responsable de ${MAX_COMUNIDADES_RESPONSABLE} comunidades.`,
        );
      }
      const comunidad: ComunidadDoc = {
        _id: new ObjectId(),
        nombre,
        tipo: datos.tipo,
        miembros: [{ uid, rol: "responsable" }],
        telegram: null,
        creado: reloj(),
      };
      await op.almacen.insertar(comunidad);
      return vistaDeComunidad(comunidad, "responsable");
    },

    async deUsuario(uid: string): Promise<ComunidadVista[]> {
      const todas = await op.almacen.deUsuario(uid);
      return todas.flatMap((c) => {
        const rol = rolDe(c, uid);
        return rol ? [vistaDeComunidad(c, rol)] : [];
      });
    },

    /**
     * La comunidad si la persona es miembro y su rol alcanza. Si no existe **o no es suya**: el
     * mismo `NoEncontrado`, para no revelar qué comunidades existen. Si es miembro pero su rol no
     * alcanza, `SinPermiso`.
     */
    async acceso(
      uid: string,
      comunidadId: ObjectId,
      minimo: Rol = "integrante",
    ): Promise<{ comunidad: ComunidadDoc; rol: Rol }> {
      const comunidad = await op.almacen.obtener(comunidadId);
      const rol = comunidad ? rolDe(comunidad, uid) : null;
      if (!comunidad || !rol) throw new NoEncontrado("No encontramos esa comunidad.");
      if (!puedeComo(rol, minimo)) throw new SinPermiso();
      return { comunidad, rol };
    },

    /** Desvincula el chat de Telegram de la comunidad (solo responsables). Es idempotente. */
    async desvincularTelegram(uid: string, comunidadId: ObjectId): Promise<ComunidadVista> {
      const { comunidad, rol } = await servicio.acceso(uid, comunidadId, "responsable");
      await op.almacen.desvincularTelegram(comunidad._id);
      return vistaDeComunidad({ ...comunidad, telegram: null }, rol);
    },
  };
  return servicio;
}

export type ServicioComunidades = ReturnType<typeof crearServicioComunidades>;
