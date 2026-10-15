import { respuestaError } from "@lympha/contracts";
import type { z } from "zod";

/** Error de la API: `codigo` es el código de dominio (`no_encontrado`, `limite_espacios`…); `status`, el HTTP. */
export class ErrorApi extends Error {
  readonly status: number;
  readonly codigo: string;
  constructor(status: number, codigo: string, mensaje: string) {
    super(mensaje);
    this.name = "ErrorApi";
    this.status = status;
    this.codigo = codigo;
  }
}

/** No hubo respuesta (sin red, API caída, CORS). Se distingue de `ErrorApi` para reintentar y avisar distinto. */
export class SinConexion extends Error {
  constructor() {
    super("No se pudo conectar con Lympha");
    this.name = "SinConexion";
  }
}

export interface OpcionesCliente {
  baseUrl: string;
  /** ID token de Firebase vigente, o `null` sin sesión. */
  obtenerToken?: () => Promise<string | null>;
  fetch?: typeof fetch;
}

export interface Peticion<E extends z.ZodTypeAny> {
  metodo?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  cuerpo?: unknown;
  /** Esquema de la respuesta. Sin él (204 o no importa el cuerpo) se devuelve `undefined`. */
  esquema?: E;
  signal?: AbortSignal;
}

export interface Cliente {
  pedir<E extends z.ZodTypeAny = z.ZodUndefined>(
    ruta: string,
    peticion?: Peticion<E>,
  ): Promise<z.infer<E>>;
  /** Para el SSE: la misma URL y autenticación, pero la respuesta se lee como flujo. */
  abrirFlujo(ruta: string, signal: AbortSignal): Promise<Response>;
}

export function crearCliente(opciones: OpcionesCliente): Cliente {
  const llamar = opciones.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const base = opciones.baseUrl.replace(/\/+$/, "");

  async function cabeceras(conCuerpo: boolean, extra?: Record<string, string>) {
    const h: Record<string, string> = { accept: "application/json", ...extra };
    // Un POST sin cuerpo NO debe llevar content-type: application/json (Fastify responde 400 "invalido").
    if (conCuerpo) h["content-type"] = "application/json";
    const token = await opciones.obtenerToken?.();
    if (token) h.authorization = `Bearer ${token}`;
    return h;
  }

  async function enviar(ruta: string, init: RequestInit): Promise<Response> {
    try {
      return await llamar(`${base}${ruta}`, init);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new SinConexion();
    }
  }

  return {
    async pedir(ruta, peticion = {}) {
      const conCuerpo = peticion.cuerpo !== undefined;
      const respuesta = await enviar(ruta, {
        method: peticion.metodo ?? "GET",
        headers: await cabeceras(conCuerpo),
        ...(conCuerpo ? { body: JSON.stringify(peticion.cuerpo) } : {}),
        ...(peticion.signal ? { signal: peticion.signal } : {}),
      });
      if (!respuesta.ok) throw await errorDe(respuesta);
      if (!peticion.esquema || respuesta.status === 204) return undefined;
      return peticion.esquema.parse(await respuesta.json());
    },

    async abrirFlujo(ruta, signal) {
      const respuesta = await enviar(ruta, {
        method: "GET",
        headers: await cabeceras(false, { accept: "text/event-stream" }),
        signal,
      });
      if (!respuesta.ok) throw await errorDe(respuesta);
      return respuesta;
    },
  };
}

async function errorDe(respuesta: Response): Promise<ErrorApi> {
  const cuerpo = respuestaError.safeParse(await respuesta.json().catch(() => null));
  return cuerpo.success
    ? new ErrorApi(respuesta.status, cuerpo.data.codigo, cuerpo.data.mensaje)
    : new ErrorApi(respuesta.status, "desconocido", "Algo salió mal");
}
