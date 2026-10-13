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

export class Conflicto extends ErrorDominio {
  constructor(
    mensaje = "La operación entra en conflicto con el estado actual",
    codigo = "conflicto",
  ) {
    super(codigo, mensaje, 409);
  }
}

export class DemasiadasSolicitudes extends ErrorDominio {
  constructor(mensaje = "Demasiados intentos; espera unos minutos") {
    super("demasiadas_solicitudes", mensaje, 429);
  }
}

/** Mismo error para nodo inexistente, código equivocado, nodo ya reclamado o lote revocado. */
export class ReclamoInvalido extends ErrorDominio {
  constructor() {
    super("reclamo_invalido", "Nodo o código no válidos", 404);
  }
}

export class InvitacionInvalida extends ErrorDominio {
  constructor() {
    super("invitacion_invalida", "Invitación no válida o vencida", 404);
  }
}

export function esErrorDominio(error: unknown): error is ErrorDominio {
  return error instanceof ErrorDominio;
}

/** Código de Postgres (SQLSTATE) y mensaje de un error de `pg`; Drizzle lo envuelve en `cause`. */
function origenPg(error: unknown): { code: string; message: string } | null {
  let actual: unknown = error;
  for (let i = 0; i < 5 && actual instanceof Error; i++) {
    const code = (actual as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
      return { code, message: actual.message };
    }
    actual = actual.cause;
  }
  return null;
}

/**
 * Traduce los errores que las funciones SQL y las restricciones de la base lanzan a propósito.
 * `null` si no es uno de ellos (se trata como error interno). Los mensajes al cliente son fijos.
 */
export function traducirErrorPg(error: unknown): ErrorDominio | null {
  const pg = origenPg(error);
  if (!pg) return null;
  if (pg.code === "42501") return new Prohibido();
  if (pg.code === "P0001") {
    switch (pg.message) {
      case "reclamo_invalido":
        return new ReclamoInvalido();
      case "invitacion_invalida":
        return new InvitacionInvalida();
      case "limite_espacios":
        return new Conflicto("Alcanzaste el máximo de espacios", "limite_espacios");
      case "transferir_primero":
        return new Conflicto(
          "Transfiere la propiedad de tus espacios compartidos antes de continuar",
          "transferir_primero",
        );
      case "transferencia_invalida":
        return new Invalido("El destino debe ser otro miembro del espacio");
      default:
        return null;
    }
  }
  // llave foránea (perfil inexistente), texto/enum inválido, violación de CHECK o de unicidad
  if (["23503", "22P02", "23514"].includes(pg.code)) return new Invalido();
  if (pg.code === "23505") return new Conflicto();
  return null;
}
