import { describe, expect, it } from "vitest";
import { ErrorApi } from "./cliente.ts";
import { crearAnalizadorSse, type EstadoFlujo, type MensajeSse, mantenerFlujo } from "./sse.ts";

function analizar(trozos: string[]): MensajeSse[] {
  const salida: MensajeSse[] = [];
  const a = crearAnalizadorSse((m) => salida.push(m));
  for (const t of trozos) a.alimentar(t);
  return salida;
}

describe("crearAnalizadorSse", () => {
  it("lee un mensaje completo", () => {
    expect(analizar(['event: estado\ndata: {"a":1}\n\n'])).toEqual([
      { evento: "estado", datos: '{"a":1}' },
    ]);
  });

  it("junta un mensaje partido en trozos de cualquier tamaño, incluso en mitad de una línea", () => {
    const texto =
      'retry: 3000\n\nevent: snapshot\ndata: {"nodos":[]}\n\n: latido\n\nevent: estado\ndata: {"b":2}\n\n';
    const esperado = [
      { evento: "snapshot", datos: '{"nodos":[]}' },
      { evento: "estado", datos: '{"b":2}' },
    ];
    expect(analizar([texto])).toEqual(esperado);
    expect(analizar(texto.split(""))).toEqual(esperado); // un carácter a la vez
    expect(analizar([texto.slice(0, 33), texto.slice(33)])).toEqual(esperado);
  });

  it("ignora comentarios y retry, y acepta \\r\\n y \\r", () => {
    expect(analizar([": latido\n\n", "retry: 5\n\n"])).toEqual([]);
    expect(analizar(["event: a\r\ndata: x\r\n\r\n"])).toEqual([{ evento: "a", datos: "x" }]);
    // un \r al final del trozo espera al siguiente por si viene \n; con más datos detrás, el mensaje sale
    expect(analizar(["event: a\rdata: x\r\rdata: y"])).toEqual([{ evento: "a", datos: "x" }]);
    // \r\n partido justo entre los dos caracteres
    expect(analizar(["event: a\r", "\ndata: x\r", "\n\r", "\n"])).toEqual([
      { evento: "a", datos: "x" },
    ]);
  });

  it("une varias líneas data con saltos de línea y no entrega mensajes sin datos", () => {
    expect(analizar(["event: a\ndata: uno\ndata: dos\n\n"])).toEqual([
      { evento: "a", datos: "uno\ndos" },
    ]);
    expect(analizar(["event: a\n\n"])).toEqual([]);
  });

  it("un mensaje sin event: es del tipo message", () => {
    expect(analizar(["data: x\n\n"])).toEqual([{ evento: "message", datos: "x" }]);
  });

  it("un mensaje incompleto no se entrega hasta que llega su línea en blanco", () => {
    expect(analizar(["event: a\ndata: x\n"])).toEqual([]);
  });
});

/** Respuesta cuyo cuerpo emite los trozos dados; con `cerrar: false` se queda abierta (muda) hasta que la cancelen. */
function respuesta(trozos: string[], cerrar = true, signal?: AbortSignal): Response {
  const codificador = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controlador) {
        for (const t of trozos) controlador.enqueue(codificador.encode(t));
        if (cerrar) controlador.close();
        const cortar = () => {
          try {
            controlador.error(new DOMException("abortado", "AbortError"));
          } catch {
            // ya cerrado
          }
        };
        if (signal?.aborted) cortar();
        else signal?.addEventListener("abort", cortar);
      },
    }),
    { status: 200 },
  );
}

describe("mantenerFlujo", () => {
  it("reabre la conexión cuando se cierra, con espera creciente, y cada una trae su snapshot", async () => {
    const mensajes: string[] = [];
    const estados: EstadoFlujo[] = [];
    const esperas: number[] = [];
    const control = new AbortController();
    let intento = 0;
    await mantenerFlujo({
      signal: control.signal,
      abrir: async () => respuesta([`event: snapshot\ndata: ${++intento}\n\n`]),
      alMensaje: (m) => {
        mensajes.push(m.datos);
        if (intento === 3 && m.datos === "3") control.abort();
      },
      alEstado: (e) => estados.push(e),
      esperar: async (ms) => {
        esperas.push(ms);
      },
    });
    expect(mensajes).toEqual(["1", "2", "3"]);
    expect(esperas.slice(0, 2)).toEqual([1000, 1000]); // un intento con éxito reinicia la espera
    expect(estados.slice(0, 4)).toEqual(["conectando", "en_vivo", "reconectando", "en_vivo"]);
  });

  it("la espera crece 1 s, 2 s, 4 s… mientras la conexión falla, y tiene tope", async () => {
    const esperas: number[] = [];
    const control = new AbortController();
    await mantenerFlujo({
      signal: control.signal,
      abrir: async () => {
        throw new TypeError("Failed to fetch");
      },
      alMensaje: () => undefined,
      alEstado: () => undefined,
      esperar: async (ms) => {
        esperas.push(ms);
        if (esperas.length === 8) control.abort();
      },
    });
    expect(esperas).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
  });

  it("un 401, 403 o 404 no se reintenta: la persona ya no tiene acceso", async () => {
    for (const status of [401, 403, 404]) {
      const estados: EstadoFlujo[] = [];
      const control = new AbortController();
      let llamadas = 0;
      await mantenerFlujo({
        signal: control.signal,
        abrir: async () => {
          llamadas++;
          throw new ErrorApi(status, "x", "x");
        },
        alMensaje: () => undefined,
        alEstado: (e) => estados.push(e),
        // si el código reintentara, se corta a los 5 intentos para que la prueba falle en vez de colgarse
        esperar: async () => {
          if (llamadas >= 5) control.abort();
        },
      });
      expect(llamadas).toBe(1);
      expect(estados.at(-1)).toBe("sin_acceso");
    }
  });

  it("un error de servidor (5xx) sí se reintenta", async () => {
    const control = new AbortController();
    let llamadas = 0;
    await mantenerFlujo({
      signal: control.signal,
      abrir: async () => {
        llamadas++;
        if (llamadas === 3) control.abort();
        throw new ErrorApi(503, "x", "x");
      },
      alMensaje: () => undefined,
      alEstado: () => undefined,
      esperar: async () => undefined,
    });
    expect(llamadas).toBe(3);
  });

  it("una conexión muda (sin datos ni latidos) se da por muerta y se reabre", async () => {
    const control = new AbortController();
    const estados: EstadoFlujo[] = [];
    let llamadas = 0;
    await mantenerFlujo({
      signal: control.signal,
      silencioMs: 30,
      abrir: async (signal) => {
        llamadas++;
        if (llamadas === 2) control.abort();
        return respuesta([], false, signal); // abierta pero muda
      },
      alMensaje: () => undefined,
      alEstado: (e) => estados.push(e),
      esperar: async () => undefined,
    });
    expect(llamadas).toBe(2);
    expect(estados).toContain("reconectando");
  });

  it("cancelar el signal termina el ciclo aunque la conexión siga abierta", async () => {
    const control = new AbortController();
    const fin = mantenerFlujo({
      signal: control.signal,
      silencioMs: 10_000,
      abrir: async (signal) => respuesta(["event: a\ndata: x\n\n"], false, signal),
      alMensaje: () => control.abort(),
      alEstado: () => undefined,
      esperar: async () => undefined,
    });
    await expect(fin).resolves.toBeUndefined();
  });
});
