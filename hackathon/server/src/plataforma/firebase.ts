import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { IdentidadVerificada, VerificadorToken } from "../modulos/identidad/index.ts";

/**
 * Única pieza que habla con Firebase. Solo se usa para **verificar** el ID token: sin sesiones ni
 * contraseñas propias y sin cuenta de servicio (verificar la firma solo necesita las llaves públicas).
 */

export type OpcionesFirebase = {
  projectId: string;
  /** Acepta los tokens sin firma del emulador. Lo prohíbe la configuración fuera de `APP_ENV=local`. */
  usarEmulador: boolean;
  hostEmulador: string;
};

/**
 * firebase-admin decide por sí solo si usa el emulador mirando `FIREBASE_AUTH_EMULATOR_HOST` en el
 * entorno del proceso. Para que una variable suelta nunca lo active sin querer, el entorno queda
 * EXACTAMENTE como dice `FIREBASE_USE_EMULATOR`: con `true` se fija al host; con `false` se borra.
 */
export function prepararEntornoFirebase(
  o: Pick<OpcionesFirebase, "usarEmulador" | "hostEmulador">,
) {
  if (o.usarEmulador) process.env.FIREBASE_AUTH_EMULATOR_HOST = o.hostEmulador;
  else delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
}

export function crearVerificadorFirebase(op: OpcionesFirebase): VerificadorToken {
  prepararEntornoFirebase(op);
  const nombre = `atl-${op.projectId}-${op.usarEmulador ? "emulador" : "real"}`;
  const app =
    getApps().find((a) => a.name === nombre) ?? initializeApp({ projectId: op.projectId }, nombre);
  const auth = getAuth(app);

  return {
    async verificar(token): Promise<IdentidadVerificada> {
      const d = await auth.verifyIdToken(token);
      if (!d.email) throw new Error("el token no trae correo");
      if (d.email_verified !== true) throw new Error("el correo no está verificado");
      return { uid: d.uid, correo: d.email, nombre: typeof d.name === "string" ? d.name : null };
    },
  };
}

/**
 * Token sin firma con la forma de los que emite el emulador de Auth. Solo sirve con
 * `FIREBASE_USE_EMULATOR=true`: con Firebase real, la firma no existe y se rechaza.
 * Es lo que usa `pnpm dev:token` para probar la API sin iniciar sesión con Google.
 */
export function tokenDeEmulador(
  d: { projectId: string; uid: string; correo: string; nombre?: string },
  ahora: Date = new Date(),
  vigenciaS = 3600,
): string {
  const codificar = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const iat = Math.floor(ahora.getTime() / 1000);
  const encabezado = { alg: "none", typ: "JWT" };
  const cuerpo = {
    iss: `https://securetoken.google.com/${d.projectId}`,
    aud: d.projectId,
    auth_time: iat,
    user_id: d.uid,
    sub: d.uid,
    iat,
    exp: iat + vigenciaS,
    email: d.correo,
    email_verified: true,
    ...(d.nombre ? { name: d.nombre } : {}),
    firebase: { identities: { email: [d.correo] }, sign_in_provider: "password" },
  };
  return `${codificar(encabezado)}.${codificar(cuerpo)}.`;
}
