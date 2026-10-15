/** Lo que la PWA necesita saber de quien tiene la sesión abierta (nunca la contraseña ni el token). */
export interface UsuarioSesion {
  uid: string;
  correo: string | null;
  nombre: string | null;
}

export type EstadoSesion =
  | { tipo: "cargando" }
  | { tipo: "fuera" }
  | { tipo: "dentro"; usuario: UsuarioSesion };

/** Un fallo de acceso con un mensaje ya listo para mostrar. */
export class ErrorAcceso extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorAcceso";
  }
}

/**
 * Identidad del navegador. La implementación real es Firebase Auth (`firebase.ts`); las pruebas usan un servicio
 * falso. Los métodos de acceso lanzan `ErrorAcceso`.
 */
export interface ServicioSesion {
  /** Avisa de la sesión actual (`null` = sin sesión) y de cada cambio. Devuelve la función para dejar de escuchar. */
  alCambiar(oyente: (usuario: UsuarioSesion | null) => void): () => void;
  /** ID token vigente (se renueva solo), o `null` sin sesión. */
  obtenerToken(): Promise<string | null>;
  entrar(correo: string, contrasena: string): Promise<void>;
  crearCuenta(correo: string, contrasena: string, nombre: string): Promise<void>;
  entrarConGoogle(): Promise<void>;
  salir(): Promise<void>;
}

const MENSAJES: Record<string, string> = {
  // Un solo mensaje para correo inexistente y contraseña errónea: no revela qué cuentas existen.
  "auth/invalid-credential": "Correo o contraseña incorrectos.",
  "auth/user-not-found": "Correo o contraseña incorrectos.",
  "auth/wrong-password": "Correo o contraseña incorrectos.",
  "auth/invalid-email": "Escribe un correo válido.",
  "auth/missing-password": "Escribe tu contraseña.",
  "auth/email-already-in-use": "Ya existe una cuenta con ese correo. Prueba entrar.",
  "auth/weak-password": "La contraseña es muy corta: usa al menos 6 caracteres.",
  "auth/too-many-requests": "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
  "auth/user-disabled": "Esta cuenta está deshabilitada.",
  "auth/network-request-failed": "No hay conexión. Revisa tu red e inténtalo de nuevo.",
  "auth/popup-closed-by-user": "Cerraste la ventana de Google antes de terminar.",
  "auth/cancelled-popup-request": "Cerraste la ventana de Google antes de terminar.",
  "auth/popup-blocked":
    "Tu navegador bloqueó la ventana de Google. Permite las ventanas emergentes.",
};

const MENSAJE_GENERICO = "No se pudo completar el acceso. Inténtalo de nuevo.";

/** Mensaje en español (México) para un código de error de Firebase Auth. Nunca expone el código ni la traza. */
export function traducirErrorAcceso(codigo: unknown): string {
  return (typeof codigo === "string" && MENSAJES[codigo]) || MENSAJE_GENERICO;
}
