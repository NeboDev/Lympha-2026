import type { VerificadorToken } from "../../src/modules/identidad/index.ts";

/**
 * Verificador de pruebas: el "token" es `uid|correo|nombre`. Cualquier otra cosa es inválida. Sirve para
 * probar la API sin Firebase; la verificación real se ejercita contra el emulador (ver README).
 */
export const verificadorDePrueba: VerificadorToken = {
  async verificar(token) {
    const [authUid, email, nombre] = token.split("|");
    if (!authUid || !email) throw new Error("token inválido");
    return { authUid, email, nombre: nombre ?? null };
  },
};

export const tokenDe = (authUid: string, email: string, nombre?: string) =>
  `Bearer ${authUid}|${email}${nombre ? `|${nombre}` : ""}`;
