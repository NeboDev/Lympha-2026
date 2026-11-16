import { z } from "zod";

/** Única pieza que habla con Blynk (HTTP API externa). */

/** Error de Blynk. Nunca incluye la URL ni el token. */
export class BlynkError extends Error {
  readonly estado: number | null;
  constructor(mensaje: string, estado: number | null = null) {
    super(mensaje);
    this.name = "BlynkError";
    this.estado = estado;
  }
}

const PIN = /^v\d{1,3}$/i;
const respuestaTodo = z.record(z.union([z.number(), z.string()]));

export type OpcionesBlynk = {
  host: string;
  /** Inyectable para pruebas. */
  fetch?: typeof fetch;
  tiempoMs?: number;
};

export function crearClienteBlynk(opciones: OpcionesBlynk) {
  const f = opciones.fetch ?? fetch;
  const tiempoMs = opciones.tiempoMs ?? 5000;

  async function llamar(ruta: string, token: string, params: Record<string, string>) {
    const url = new URL(`https://${opciones.host}/external/api/${ruta}`);
    url.searchParams.set("token", token);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let r: Response;
    try {
      r = await f(url, { signal: AbortSignal.timeout(tiempoMs) });
    } catch {
      throw new BlynkError("Sin respuesta de Blynk");
    }
    if (!r.ok) throw new BlynkError(`Blynk respondió ${r.status}`, r.status);
    return r;
  }

  return {
    /**
     * Escribe varios pines virtuales en una sola petición con `batch/update`.
     * (Verificado: `update` con varios pines solo aplica el primero y responde 200 igual.)
     */
    async escribirPines(token: string, pines: Record<string, number | string>): Promise<void> {
      const params: Record<string, string> = {};
      for (const [pin, valor] of Object.entries(pines)) {
        if (!PIN.test(pin)) throw new BlynkError(`Pin inválido: ${pin}`);
        if (typeof valor === "number" && !Number.isFinite(valor)) {
          throw new BlynkError(`Valor no finito para ${pin}`);
        }
        params[pin.toLowerCase()] = String(valor);
      }
      if (Object.keys(params).length === 0) throw new BlynkError("No hay pines que escribir");
      await llamar("batch/update", token, params);
    },

    /** Todos los valores del dispositivo: `{ v2: 7.1, v6: 42, … }`. */
    async leerTodo(token: string): Promise<Record<string, number | string>> {
      const r = await llamar("getAll", token, {});
      const datos = respuestaTodo.safeParse(await r.json().catch(() => null));
      if (!datos.success) throw new BlynkError("Respuesta de Blynk con forma inesperada");
      return datos.data;
    },

    /** `true` si la placa está conectada a Blynk. */
    async nodoConectado(token: string): Promise<boolean> {
      const r = await llamar("isHardwareConnected", token, {});
      return (await r.text()).trim() === "true";
    },
  };
}

export type ClienteBlynk = ReturnType<typeof crearClienteBlynk>;

/** Comprueba que el host de Blynk contesta (para /api/salud). */
export async function blynkAlcanzable(host: string, tiempoMs = 3000): Promise<boolean> {
  try {
    // Un token inválido responde 400: basta con que el servidor conteste.
    const r = await fetch(`https://${host}/external/api/isHardwareConnected?token=salud`, {
      signal: AbortSignal.timeout(tiempoMs),
    });
    return r.status > 0 && r.status < 500;
  } catch {
    return false;
  }
}
