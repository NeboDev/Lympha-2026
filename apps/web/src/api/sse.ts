import { ErrorApi } from "./cliente.ts";

export interface MensajeSse {
  evento: string;
  datos: string;
}

/**
 * Analizador incremental de `text/event-stream`: recibe texto en trozos de cualquier tamaño (un mensaje puede
 * llegar partido) y entrega cada mensaje completo. Ignora comentarios (`: latido`) y `retry:`; une varias líneas
 * `data:` con saltos de línea; acepta `\n`, `\r\n` y `\r`. Un mensaje sin `data:` no se entrega.
 */
export function crearAnalizadorSse(alMensaje: (mensaje: MensajeSse) => void) {
  let pendiente = "";
  let evento = "";
  let datos: string[] = [];

  const cerrarMensaje = () => {
    if (datos.length > 0) alMensaje({ evento: evento || "message", datos: datos.join("\n") });
    evento = "";
    datos = [];
  };

  const procesarLinea = (linea: string) => {
    if (linea === "") return cerrarMensaje();
    if (linea.startsWith(":")) return;
    const i = linea.indexOf(":");
    const campo = i < 0 ? linea : linea.slice(0, i);
    const valor = i < 0 ? "" : linea.slice(i + 1).replace(/^ /, "");
    if (campo === "event") evento = valor;
    else if (campo === "data") datos.push(valor);
  };

  return {
    alimentar(texto: string) {
      pendiente += texto;
      // una línea termina en \n, \r\n o \r; un \r al final del trozo espera al siguiente por si viene \n
      for (;;) {
        const corte = pendiente.search(/\r\n|\n|\r(?!$)/);
        if (corte < 0) return;
        const linea = pendiente.slice(0, corte);
        pendiente = pendiente.slice(
          pendiente[corte] === "\r" && pendiente[corte + 1] === "\n" ? corte + 2 : corte + 1,
        );
        procesarLinea(linea);
      }
    },
  };
}

export type EstadoFlujo = "conectando" | "en_vivo" | "reconectando" | "sin_acceso";

export interface OpcionesFlujo {
  /** Abre la conexión (ya autenticada). Se llama de nuevo en cada reconexión. */
  abrir: (signal: AbortSignal) => Promise<Response>;
  alMensaje: (mensaje: MensajeSse) => void;
  alEstado: (estado: EstadoFlujo) => void;
  signal: AbortSignal;
  /** Sin ningún dato (ni latido) durante este tiempo, la conexión se da por muerta y se reabre. El servidor late cada 20 s. */
  silencioMs?: number;
  /** Espera entre intentos: 1 s, 2 s, 4 s… hasta 30 s. Inyectable para las pruebas. */
  esperar?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const ESPERA_MAXIMA_MS = 30_000;

const dormir = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolver) => {
    const t = setTimeout(resolver, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolver();
      },
      { once: true },
    );
  });

/**
 * Mantiene abierto el stream de un espacio hasta que `signal` se cancele: lee los mensajes y, si la conexión se
 * cae o se queda muda, la reabre con espera creciente. Un 401, 403 o 404 (sesión inválida, sin acceso o espacio
 * inexistente) no se reintenta. Cada reconexión recibe de nuevo el `snapshot`, que corrige lo que se perdió.
 */
export async function mantenerFlujo(op: OpcionesFlujo): Promise<void> {
  const silencioMs = op.silencioMs ?? 45_000;
  const esperar = op.esperar ?? dormir;
  let intentos = 0;
  op.alEstado("conectando");

  while (!op.signal.aborted) {
    // cancelable por separado: el vigilante de silencio corta solo esta conexión, no todo el ciclo
    const conexion = new AbortController();
    const cancelarTodo = () => conexion.abort();
    op.signal.addEventListener("abort", cancelarTodo, { once: true });
    let vigilante: ReturnType<typeof setTimeout> | undefined;
    const armar = () => {
      clearTimeout(vigilante);
      vigilante = setTimeout(() => conexion.abort(), silencioMs);
    };

    try {
      const respuesta = await op.abrir(conexion.signal);
      if (!respuesta.body) throw new Error("sin cuerpo");
      intentos = 0;
      op.alEstado("en_vivo");
      armar();
      const analizador = crearAnalizadorSse(op.alMensaje);
      const lector = respuesta.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await lector.read();
        if (done) break;
        armar();
        analizador.alimentar(value);
      }
    } catch (error) {
      if (op.signal.aborted) break;
      if (error instanceof ErrorApi && [401, 403, 404].includes(error.status)) {
        op.alEstado("sin_acceso");
        return;
      }
    } finally {
      clearTimeout(vigilante);
      op.signal.removeEventListener("abort", cancelarTodo);
      conexion.abort();
    }

    if (op.signal.aborted) break;
    op.alEstado("reconectando");
    const espera = Math.min(ESPERA_MAXIMA_MS, 1000 * 2 ** intentos++);
    await esperar(espera, op.signal);
  }
}
