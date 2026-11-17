/**
 * Errores de dominio: clases tipadas que la capa HTTP traduce a un código y un estado. Nunca llevan
 * trazas ni datos internos: lo que dicen es lo único que ve el cliente.
 */

export class ErrorDominio extends Error {
  readonly codigo: string;
  readonly estado: number;
  constructor(estado: number, codigo: string, mensaje: string) {
    super(mensaje);
    this.name = new.target.name;
    this.codigo = codigo;
    this.estado = estado;
  }
}

/** Falta el token, es inválido, venció o no es de este proyecto. */
export class NoAutenticado extends ErrorDominio {
  constructor(mensaje = "Hace falta iniciar sesión.") {
    super(401, "no_autenticado", mensaje);
  }
}

/** El recurso no existe **o no es tuyo**: no se distingue, para no revelar qué existe. */
export class NoEncontrado extends ErrorDominio {
  constructor(mensaje = "No se encontró.") {
    super(404, "no_encontrado", mensaje);
  }
}

/** La persona es parte de la comunidad pero su rol no alcanza para esto. */
export class SinPermiso extends ErrorDominio {
  constructor(mensaje = "Tu rol en esta comunidad no permite hacer esto.") {
    super(403, "sin_permiso", mensaje);
  }
}

export class Conflicto extends ErrorDominio {
  constructor(codigo: string, mensaje: string) {
    super(409, codigo, mensaje);
  }
}

/** La petición está bien formada pero no se puede cumplir (token de Blynk inválido, periodo largo…). */
export class SolicitudInvalida extends ErrorDominio {
  constructor(codigo: string, mensaje: string) {
    super(422, codigo, mensaje);
  }
}

export class ServicioNoDisponible extends ErrorDominio {
  constructor(codigo: string, mensaje: string) {
    super(503, codigo, mensaje);
  }
}

export type Rol = "responsable" | "integrante";

/** Quién puede hacer qué: `responsable` vincula, calibra y da de alta; `integrante` lee y anota. */
export const puedeComo = (rol: Rol, minimo: Rol): boolean =>
  minimo === "integrante" || rol === "responsable";
