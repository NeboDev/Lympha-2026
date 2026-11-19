import { describe, expect, it } from "vitest";
import { z } from "zod";
import { crearCliente, ErrorApi, nombreDeArchivo, SinConexion } from "./cliente.ts";
import { mensajeDeError } from "./mensajes.ts";

type Llamada = { url: string; init: RequestInit };

function escenario(respuestas: (Response | Error)[], token: string | null = "tok-123") {
  const llamadas: Llamada[] = [];
  let noAutenticado = 0;
  const f = (async (url: string, init: RequestInit) => {
    llamadas.push({ url: String(url), init });
    const r = respuestas.shift();
    if (r instanceof Error) throw r;
    return r ?? new Response("{}");
  }) as typeof fetch;
  const cliente = crearCliente({
    baseUrl: "http://api.local/",
    obtenerToken: async () => token,
    alNoAutenticado: () => {
      noAutenticado++;
    },
    fetch: f,
  });
  return { cliente, llamadas, noAutenticado: () => noAutenticado };
}

const cab = (e: { llamadas: Llamada[] }, i: number) =>
  (e.llamadas[i]?.init.headers ?? {}) as Record<string, string>;
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const esquema = z.object({ n: z.number(), cuando: z.coerce.date() });

describe("pedir", () => {
  it("manda el token como Bearer, quita la barra final de la base y valida la respuesta (fechas incluidas)", async () => {
    const e = escenario([json({ n: 3, cuando: "2026-11-19T15:00:00.000Z" })]);
    const r = await e.cliente.pedir("/api/yo", { esquema });
    expect(r).toEqual({ n: 3, cuando: new Date("2026-11-19T15:00:00Z") });
    expect(e.llamadas[0]?.url).toBe("http://api.local/api/yo");
    const h = e.llamadas[0]?.init.headers as Record<string, string>;
    expect(h.authorization).toBe("Bearer tok-123");
    expect(h.accept).toBe("application/json");
  });

  it("sin sesión no manda Authorization", async () => {
    const e = escenario([json({ n: 1, cuando: "2026-01-01T00:00:00Z" })], null);
    await e.cliente.pedir("/api/yo", { esquema });
    expect(cab(e, 0).authorization).toBeUndefined();
  });

  it("un POST sin cuerpo NO lleva content-type (Fastify respondería 400); con cuerpo sí", async () => {
    const e = escenario([
      json({ n: 1, cuando: "2026-01-01T00:00:00Z" }),
      json({ n: 1, cuando: "2026-01-01T00:00:00Z" }),
    ]);
    await e.cliente.pedir("/a", { metodo: "POST", esquema });
    const sin = e.llamadas[0]?.init;
    expect(cab(e, 0)["content-type"]).toBeUndefined();
    expect(sin?.body).toBeUndefined();
    await e.cliente.pedir("/b", { metodo: "POST", cuerpo: { x: 1 }, esquema });
    const con = e.llamadas[1]?.init;
    expect(cab(e, 1)["content-type"]).toBe("application/json");
    expect(con?.body).toBe('{"x":1}');
  });

  it("un DELETE sin cuerpo no lleva content-type y un 204 se acepta sin leer JSON", async () => {
    const e = escenario([new Response(null, { status: 204 })]);
    const r = await e.cliente.pedir("/api/nodos/1", { metodo: "DELETE", esquema: z.undefined() });
    expect(r).toBeUndefined();
    expect(e.llamadas[0]?.init.method).toBe("DELETE");
    expect(cab(e, 0)["content-type"]).toBeUndefined();
  });

  it("si el servidor cambia de forma, falla en vez de mostrar datos a medias", async () => {
    const e = escenario([json({ n: "no es número", cuando: "x" })]);
    await expect(e.cliente.pedir("/api/yo", { esquema })).rejects.toThrow();
  });

  it("un error de la API trae su código HTTP y de dominio", async () => {
    const e = escenario([json({ error: "nodo_repetido", mensaje: "Ya hay uno." }, 409)]);
    const error = await e.cliente.pedir("/x", { metodo: "POST", esquema }).catch((x) => x);
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error).toMatchObject({ status: 409, codigo: "nodo_repetido", message: "Ya hay uno." });
  });

  it("un error que no es JSON se vuelve «desconocido»", async () => {
    const e = escenario([new Response("<html>502</html>", { status: 502 })]);
    const error = await e.cliente.pedir("/x", { esquema }).catch((x) => x);
    expect(error).toMatchObject({ status: 502, codigo: "desconocido" });
  });

  it("un 401 avisa a la sesión (para que vuelva a entrar) y también falla", async () => {
    const e = escenario([
      json({ error: "no_autenticado", mensaje: "Hace falta iniciar sesión." }, 401),
    ]);
    await expect(e.cliente.pedir("/api/yo", { esquema })).rejects.toBeInstanceOf(ErrorApi);
    expect(e.noAutenticado()).toBe(1);
  });

  it("sin red es SinConexion; un aborto no se confunde con eso", async () => {
    const e = escenario([
      new TypeError("Failed to fetch"),
      new DOMException("cancelado", "AbortError"),
    ]);
    await expect(e.cliente.pedir("/x", { esquema })).rejects.toBeInstanceOf(SinConexion);
    const aborto = await e.cliente.pedir("/x", { esquema }).catch((x) => x);
    expect(aborto).toBeInstanceOf(DOMException);
    expect(aborto).not.toBeInstanceOf(SinConexion);
  });
});

describe("descargar", () => {
  it("devuelve el archivo y el nombre que puso el servidor", async () => {
    const e = escenario([
      new Response("%PDF-1.3", {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="reporte-tinaco-2026-11-19.pdf"',
        },
      }),
    ]);
    const a = await e.cliente.descargar("/api/nodos/1/reportes", {
      metodo: "POST",
      cuerpo: { dias: 7 },
    });
    expect(a.nombre).toBe("reporte-tinaco-2026-11-19.pdf");
    expect(await a.blob.text()).toBe("%PDF-1.3");
    expect(cab(e, 0).accept).toBe("application/pdf");
  });

  it("los errores de una descarga también son errores de la API", async () => {
    const e = escenario([json({ error: "periodo_invalido", mensaje: "No." }, 422)]);
    await expect(e.cliente.descargar("/x", { metodo: "POST" })).rejects.toMatchObject({
      codigo: "periodo_invalido",
    });
  });
});

describe("nombreDeArchivo", () => {
  it("usa el nombre de la cabecera y nunca deja que traiga una ruta", () => {
    expect(nombreDeArchivo('attachment; filename="a.pdf"')).toBe("a.pdf");
    expect(nombreDeArchivo("attachment; filename=b.pdf")).toBe("b.pdf");
    expect(nombreDeArchivo('attachment; filename="../../etc/pasa.pdf"')).toBe("pasa.pdf");
    expect(nombreDeArchivo('attachment; filename="C:\\Windows\\x.pdf"')).toBe("x.pdf");
    expect(nombreDeArchivo(null)).toBe("reporte.pdf");
    expect(nombreDeArchivo("attachment")).toBe("reporte.pdf");
  });
});

describe("mensajeDeError", () => {
  it("traduce los códigos conocidos a frases para la persona", () => {
    expect(mensajeDeError(new ErrorApi(422, "token_blynk_invalido", "x"))).toMatch(
      /Blynk no reconoce ese token/,
    );
    expect(mensajeDeError(new ErrorApi(409, "nodo_repetido", ""))).toMatch(
      /Ya hay un nodo con ese nombre/,
    );
    expect(mensajeDeError(new SinConexion())).toMatch(/Revisa tu internet/);
  });

  it("con un código desconocido usa el mensaje del servidor, y si no hay, uno genérico", () => {
    expect(mensajeDeError(new ErrorApi(400, "otro", "Mensaje del servidor."))).toBe(
      "Mensaje del servidor.",
    );
    expect(mensajeDeError(new ErrorApi(500, "desconocido", ""))).toBe(
      "Algo salió mal. Intenta de nuevo.",
    );
    expect(mensajeDeError(new Error("boom: detalle interno"))).toBe(
      "Algo salió mal. Intenta de nuevo.",
    );
  });

  it("ningún mensaje dice «potable» ni «seguro»", () => {
    for (const codigo of [
      "no_autenticado",
      "no_encontrado",
      "sin_permiso",
      "token_blynk_invalido",
      "periodo_invalido",
      "error_interno",
    ]) {
      expect(mensajeDeError(new ErrorApi(400, codigo, ""))).not.toMatch(/potable|segur[oa]s?\b/i);
    }
  });
});
