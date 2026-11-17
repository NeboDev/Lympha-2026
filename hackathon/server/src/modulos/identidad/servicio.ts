import { createHash, timingSafeEqual } from "node:crypto";
import { NoAutenticado } from "../../dominio/errores.ts";
import type { AlmacenUsuarios, IdentidadVerificada, Usuario, VerificadorToken } from "./puertos.ts";

export type OpcionesIdentidad = {
  verificador: VerificadorToken;
  almacen: AlmacenUsuarios;
  /** Token fijo del usuario de demostración; `null` lo desactiva. */
  demoToken?: string | null;
  /** Se llama con el error de Firebase cuando rechaza un token. Solo para el registro del servidor: al cliente no se le cuenta. */
  alRechazar?: (error: unknown) => void;
  reloj?: () => Date;
};

const BEARER = /^Bearer\s+(\S+)$/i;
const LARGO_MAX_TOKEN = 4096;

export const USUARIO_DEMO: IdentidadVerificada = {
  uid: "demo",
  correo: "demo@atl.local",
  nombre: "Usuario de demostración",
};

const huella = (s: string) => createHash("sha256").update(s).digest();

/**
 * Convierte la cabecera `Authorization: Bearer <token>` en una persona. Sin sesiones ni
 * contraseñas propias: el token lo emite Firebase y aquí solo se verifica.
 */
export function crearServicioIdentidad(op: OpcionesIdentidad) {
  const reloj = op.reloj ?? (() => new Date());
  const demo = op.demoToken ? huella(op.demoToken) : null;
  /** Ya registrados en este proceso, para no escribir en la base en cada petición. */
  const vistos = new Set<string>();

  async function registrar(i: IdentidadVerificada): Promise<void> {
    const clave = `${i.uid}\u0000${i.correo}\u0000${i.nombre ?? ""}`;
    if (vistos.has(clave)) return;
    await op.almacen.registrar(i, reloj());
    vistos.add(clave);
  }

  return {
    /** Lanza `NoAutenticado` (siempre el mismo mensaje) ante cualquier problema con el token. */
    async autenticar(cabecera: string | undefined): Promise<Usuario> {
      const token = cabecera ? BEARER.exec(cabecera.trim())?.[1] : undefined;
      if (!token || token.length > LARGO_MAX_TOKEN) throw new NoAutenticado();

      if (demo && timingSafeEqual(demo, huella(token))) {
        await registrar(USUARIO_DEMO);
        return { ...USUARIO_DEMO, demo: true };
      }

      let identidad: IdentidadVerificada;
      try {
        identidad = await op.verificador.verificar(token);
      } catch (e) {
        // Firebase dice por qué falló (vencido, otro proyecto…); al cliente no se le cuenta, pero al registro sí.
        op.alRechazar?.(e);
        throw new NoAutenticado();
      }
      await registrar(identidad);
      return { ...identidad, demo: false };
    },
  };
}

export type ServicioIdentidad = ReturnType<typeof crearServicioIdentidad>;
