import type { z } from "zod";
import { cuerpoError } from "./tipos.ts";

/** Error de la API: `codigo` es el código de dominio (`no_encontrado`, `nodo_repetido`…); `status`, el HTTP. */
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

/** No hubo respuesta (sin red, servidor caído, CORS). Se distingue de `ErrorApi` para avisar distinto. */
export class SinConexion extends Error {
  constructor() {
    super("No se pudo conectar con Atl");
    this.name = "SinConexion";
  }
}

export type OpcionesCliente = {
  baseUrl: string;
  /** Token vigente (de Firebase o de demostración), o `null` sin sesión. */
  obtenerToken: () => Promise<string | null>;
  /** Se llama cuando la API responde 401: la sesión ya no vale. */
  alNoAutenticado?: () => void;
  fetch?: typeof fetch;
};

export type Peticion<E extends z.ZodTypeAny> = {
  metodo?: "GET" | "POST";
  cuerpo?: unknown;
  /** Esquema de la respuesta. */
  esquema: E;
  signal?: AbortSignal;
};

export type ArchivoDescargado = { blob: Blob; nombre: string };

export type Cliente = {
  pedir<E extends z.ZodTypeAny>(ruta: string, peticion: Peticion<E>): Promise<z.infer<E>>;
  /** Para el PDF del reporte: la respuesta es un archivo, no JSON. */
  descargar(
    ruta: string,
    peticion?: { metodo?: "GET" | "POST"; cuerpo?: unknown; signal?: AbortSignal },
  ): Promise<ArchivoDescargado>;
};

/** El nombre que el servidor pone en `Content-Disposition`, o uno por omisión. */
export function nombreDeArchivo(cabecera: string | null, porOmision = "reporte.pdf"): string {
  const m = /filename="?([^";]+)"?/i.exec(cabecera ?? "");
  const nombre = m?.[1]?.trim();
  // Se descarta cualquier ruta: el nombre del archivo nunca debe poder salirse de la carpeta de descargas.
  return nombre ? (nombre.split(/[\\/]/).pop() ?? porOmision) : porOmision;
}

export function crearCliente(opciones: OpcionesCliente): Cliente {
  const llamar = opciones.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const base = opciones.baseUrl.replace(/\/+$/, "");

  async function enviar(
    ruta: string,
    metodo: "GET" | "POST",
    cuerpo: unknown,
    signal: AbortSignal | undefined,
    accept: string,
  ): Promise<Response> {
    const headers: Record<string, string> = { accept };
    // Un POST sin cuerpo NO debe llevar content-type: application/json (Fastify responde 400).
    if (cuerpo !== undefined) headers["content-type"] = "application/json";
    const token = await opciones.obtenerToken();
    if (token) headers.authorization = `Bearer ${token}`;

    let respuesta: Response;
    try {
      respuesta = await llamar(`${base}${ruta}`, {
        method: metodo,
        headers,
        ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      throw new SinConexion();
    }
    if (!respuesta.ok) {
      if (respuesta.status === 401) opciones.alNoAutenticado?.();
      throw await errorDe(respuesta);
    }
    return respuesta;
  }

  return {
    async pedir(ruta, p) {
      const r = await enviar(ruta, p.metodo ?? "GET", p.cuerpo, p.signal, "application/json");
      return p.esquema.parse(await r.json());
    },
    async descargar(ruta, p = {}) {
      const r = await enviar(ruta, p.metodo ?? "GET", p.cuerpo, p.signal, "application/pdf");
      return {
        blob: await r.blob(),
        nombre: nombreDeArchivo(r.headers.get("content-disposition")),
      };
    },
  };
}

async function errorDe(r: Response): Promise<ErrorApi> {
  const cuerpo = cuerpoError.safeParse(await r.json().catch(() => null));
  return cuerpo.success
    ? new ErrorApi(r.status, cuerpo.data.error, cuerpo.data.mensaje ?? "")
    : new ErrorApi(r.status, "desconocido", "");
}
