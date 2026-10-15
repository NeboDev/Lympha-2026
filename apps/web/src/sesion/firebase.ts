import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
  updateProfile,
} from "firebase/auth";
import {
  ErrorAcceso,
  type ServicioSesion,
  traducirErrorAcceso,
  type UsuarioSesion,
} from "./servicio.ts";

export interface ConfigFirebase {
  apiKey: string;
  authDomain: string;
  projectId: string;
  /** `host:puerto` del emulador de Auth. Solo en desarrollo; nunca en un build de producción. */
  emulador?: string | undefined;
}

const aUsuario = (u: User): UsuarioSesion => ({
  uid: u.uid,
  correo: u.email,
  nombre: u.displayName,
});

/** Firebase Auth en el navegador. La API verifica el ID token; aquí nunca se guardan contraseñas. */
export function crearServicioFirebase(config: ConfigFirebase): ServicioSesion {
  const app = initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
  });
  const auth = getAuth(app);
  if (config.emulador) {
    connectAuthEmulator(auth, `http://${config.emulador}`, { disableWarnings: true });
  }

  /** Traduce cualquier fallo de Firebase a un mensaje para la persona. */
  async function accion(tarea: () => Promise<unknown>): Promise<void> {
    try {
      await tarea();
    } catch (error) {
      throw new ErrorAcceso(traducirErrorAcceso((error as { code?: unknown }).code));
    }
  }

  const actual = (): UsuarioSesion | null => (auth.currentUser ? aUsuario(auth.currentUser) : null);

  // Al crear la cuenta Firebase abre la sesión al instante, pero el nombre se guarda después. Si la PWA la viera
  // antes, la API recibiría un token sin nombre y crearía el usuario sin él (solo lo toma al crearlo). Mientras
  // `creando`, la sesión no se anuncia; al terminar se anuncia completa.
  let creando = false;
  const escuchas = new Set<() => void>();

  return {
    alCambiar(oyente) {
      const avisar = () => oyente(actual());
      escuchas.add(avisar);
      const baja = onAuthStateChanged(auth, () => {
        if (!creando) avisar();
      });
      return () => {
        escuchas.delete(avisar);
        baja();
      };
    },

    async obtenerToken() {
      return (await auth.currentUser?.getIdToken()) ?? null;
    },

    entrar: (correo, contrasena) =>
      accion(() => signInWithEmailAndPassword(auth, correo, contrasena)),

    crearCuenta: (correo, contrasena, nombre) =>
      accion(async () => {
        creando = true;
        try {
          const { user } = await createUserWithEmailAndPassword(auth, correo, contrasena);
          await updateProfile(user, { displayName: nombre });
          // El token que ya existe no trae el nombre: se renueva para que la API lo reciba.
          await user.getIdToken(true);
          // Fuera de local la API exige correo verificado (con el emulador no hay correo que enviar).
          if (!config.emulador) await sendEmailVerification(user);
        } finally {
          creando = false;
          for (const avisar of [...escuchas]) avisar();
        }
      }),

    entrarConGoogle: () => accion(() => signInWithPopup(auth, new GoogleAuthProvider())),

    salir: () => accion(() => signOut(auth)),
  };
}
