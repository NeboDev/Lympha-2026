import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { type CuentaServicio, parsearCuentaServicio } from "../../platform/config.ts";

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
   * Con el emulador de Auth firebase-admin acepta los tokens sin firma que emite el emulador; sin él, verifica
   * la firma contra las llaves públicas de Google. Lo decide `FIREBASE_USE_EMULATOR` (ver `prepararEntornoFirebase`).
   */
  exigirCorreoVerificado: boolean;
  /** Cuenta de servicio opcional (JSON o base64). Verificar tokens no la necesita. */
  cuentaServicio?: string | undefined;
}

/**
 * firebase-admin decide por sí solo si usa el emulador mirando `FIREBASE_AUTH_EMULATOR_HOST` en el entorno del
 * proceso. Para que una variable suelta nunca lo active sin querer, el entorno se deja EXACTAMENTE como dice
 * `FIREBASE_USE_EMULATOR`: con `true` se fija al host configurado; con `false` se borra.
 */
export function prepararEntornoFirebase(c: {
  FIREBASE_USE_EMULATOR: boolean;
  FIREBASE_AUTH_EMULATOR_HOST?: string | undefined;
}): void {
  if (c.FIREBASE_USE_EMULATOR && c.FIREBASE_AUTH_EMULATOR_HOST) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = c.FIREBASE_AUTH_EMULATOR_HOST;
  } else {
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
  }
}

/** Verificación con firebase-admin. Es lo único que se usa de Firebase: sin sesiones ni contraseñas propias. */
export function crearVerificadorFirebase(op: OpcionesFirebase): VerificadorToken {
  let cuenta: CuentaServicio | undefined;
  if (op.cuentaServicio) {
    const r = parsearCuentaServicio(op.cuentaServicio);
    if (!r.ok) throw new Error(`FIREBASE_SERVICE_ACCOUNT inválida: ${r.motivo}`);
    cuenta = r.cuenta;
  }
  const app =
    getApps().find((a) => a.name === "lympha") ??
    initializeApp(
      {
        projectId: op.projectId,
        ...(cuenta
          ? {
              credential: cert({
                projectId: cuenta.project_id,
                clientEmail: cuenta.client_email,
                privateKey: cuenta.private_key,
              }),
            }
          : {}),
      },
      "lympha",
    );
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
