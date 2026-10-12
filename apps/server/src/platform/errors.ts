/**
 * Errores de dominio tipados. La capa HTTP los traduce a códigos; nunca se exponen trazas.
 * Sin parámetros-propiedad (`erasableSyntaxOnly`).
 */
export class ErrorDominio extends Error {
  readonly codigo: string;
  readonly status: number;

  constructor(codigo: string, mensaje: string, status: number) {
    super(mensaje);
    this.name = new.target.name;
    this.codigo = codigo;
    this.status = status;
  }
}

export class NoEncontrado extends ErrorDominio {
  constructor(mensaje = "No encontrado") {
    super("no_encontrado", mensaje, 404);
  }
}

export class NoAutenticado extends ErrorDominio {
  constructor(mensaje = "Autenticación requerida") {
    super("no_autenticado", mensaje, 401);
  }
}

export class Prohibido extends ErrorDominio {
  constructor(mensaje = "Acción no permitida") {
    super("prohibido", mensaje, 403);
  }
}

export class Invalido extends ErrorDominio {
  constructor(mensaje = "Solicitud inválida") {
    super("invalido", mensaje, 400);
  }
}

export function esErrorDominio(error: unknown): error is ErrorDominio {
  return error instanceof ErrorDominio;
}
