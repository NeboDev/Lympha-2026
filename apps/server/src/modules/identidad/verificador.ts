import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

/** Lo único que el servidor toma de un token de Firebase. */
export interface IdentidadVerificada {
  authUid: string;
  email: string;
  nombre: string | null;
}

export interface VerificadorToken {
  /** Lanza si el token es inválido, está vencido o no es del proyecto. */
  verificar(token: string): Promise<IdentidadVerificada>;
}

export class CorreoNoVerificado extends Error {
  constructor() {
    super("la cuenta no tiene un correo verificado");
    this.name = "CorreoNoVerificado";
  }
}

export interface OpcionesFirebase {
  projectId: string;
  /**
   * Con el emulador de Auth (`FIREBASE_AUTH_EMULATOR_HOST`, solo APP_ENV=local) firebase-admin acepta los
   * tokens sin firma que emite el emulador; sin él, verifica la firma contra las llaves públicas de Google.
   */
  exigirCorreoVerificado: boolean;
}

/** Verificación con firebase-admin. Es lo único que se usa de Firebase: sin sesiones ni contraseñas propias. */
export function crearVerificadorFirebase(op: OpcionesFirebase): VerificadorToken {
  const app =
    getApps().find((a) => a.name === "lympha") ??
    initializeApp({ projectId: op.projectId }, "lympha");
  const auth = getAuth(app);
  return {
    async verificar(token) {
      const d = await auth.verifyIdToken(token);
      if (!d.email) throw new Error("el token no trae correo");
      if (op.exigirCorreoVerificado && d.email_verified !== true) throw new CorreoNoVerificado();
      return { authUid: d.uid, email: d.email, nombre: typeof d.name === "string" ? d.name : null };
    },
  };
}
