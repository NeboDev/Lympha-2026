import { getApps, initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import type { ConfigFirebase } from "../config.ts";

/** La persona que inició sesión. El correo solo se muestra; la API verifica el token, no esto. */
export type PersonaSesion = { uid: string; nombre: string | null; correo: string | null };

/** Lo que la web necesita del acceso con Google; así el resto no importa `firebase`. */
export type AccesoGoogle = {
  /** Avisa cuando cambia la sesión (también al cargar la página). Devuelve cómo dejar de escuchar. */
  alCambiar(oyente: (persona: PersonaSesion | null) => void): () => void;
  /** Token vigente (Firebase lo renueva solo), o `null` sin sesión. */
  obtenerToken(): Promise<string | null>;
  entrar(): Promise<void>;
  salir(): Promise<void>;
};

/** Mensaje para la persona según el código de error de Firebase. Nunca el texto técnico. */
export function traducirErrorAcceso(codigo: unknown): string {
  switch (codigo) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Cerraste la ventana antes de terminar. Inténtalo de nuevo cuando quieras.";
    case "auth/popup-blocked":
      return "El navegador bloqueó la ventana de Google. Permite las ventanas emergentes para este sitio e inténtalo de nuevo.";
    case "auth/network-request-failed":
      return "No pudimos conectar con Google. Revisa tu internet e inténtalo de nuevo.";
    case "auth/unauthorized-domain":
      return "Este sitio no está autorizado en Firebase. Quien administra el proyecto debe agregar el dominio en Authentication > Configuración > Dominios autorizados.";
    case "auth/operation-not-allowed":
      return "El acceso con Google no está activado en el proyecto de Firebase.";
    default:
      return "No pudimos iniciar sesión. Inténtalo de nuevo.";
  }
}

export class ErrorAcceso extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorAcceso";
  }
}

const aPersona = (u: User): PersonaSesion => ({
  uid: u.uid,
  nombre: u.displayName,
  correo: u.email,
});

/** Firebase Auth en el navegador. Aquí nunca se guardan contraseñas: solo el acceso con Google. */
export function crearAccesoGoogle(config: ConfigFirebase): AccesoGoogle {
  const app =
    getApps()[0] ??
    initializeApp({
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      ...(config.appId ? { appId: config.appId } : {}),
    });
  const auth = getAuth(app);

  async function accion(tarea: () => Promise<unknown>): Promise<void> {
    try {
      await tarea();
    } catch (e) {
      throw new ErrorAcceso(traducirErrorAcceso((e as { code?: unknown }).code));
    }
  }

  return {
    alCambiar(oyente) {
      return onAuthStateChanged(auth, (u) => oyente(u ? aPersona(u) : null));
    },
    async obtenerToken() {
      return (await auth.currentUser?.getIdToken()) ?? null;
    },
    entrar: () => accion(() => signInWithPopup(auth, new GoogleAuthProvider())),
    salir: () => accion(() => signOut(auth)),
  };
}
