import { respuestaHealth } from "@lympha/contracts";
import { describe, expect, it } from "vitest";
import { crearCliente, ErrorApi, SinConexion } from "./cliente.ts";

interface Llamada {
  url: string;
  init: RequestInit;
}

function conRespuesta(respuesta: Response | Error) {
  const llamadas: Llamada[] = [];
  const falso = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, init });
    if (respuesta instanceof Error) throw respuesta;
    return respuesta.clone();
  }) as unknown as typeof fetch;
  return { llamadas, fetch: falso };
}

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": "application/json" },
  });

const HEALTH = {
  estado: "ok",
  version: "x",
  componentes: { postgres: "ok", valkey: "ok", mqtt: "ok" },
};

describe("cliente de la API", () => {
  it("manda el Bearer y valida la respuesta con el esquema", async () => {
    const { llamadas, fetch } = conRespuesta(json(HEALTH));
    const c = crearCliente({ baseUrl: "http://api/", obtenerToken: async () => "tok", fetch });
    const r = await c.pedir("/health", { esquema: respuestaHealth });
    expect(r.estado).toBe("ok");
    expect(llamadas[0]?.url).toBe("http://api/health");
    expect((llamadas[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("sin sesión no manda Authorization", async () => {
    const { llamadas, fetch } = conRespuesta(json(HEALTH));
    await crearCliente({ baseUrl: "http://api", fetch }).pedir("/health");
    expect((llamadas[0]?.init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("un POST sin cuerpo NO envía content-type (Fastify respondería 400)", async () => {
    const { llamadas, fetch } = conRespuesta(new Response(null, { status: 204 }));
    const c = crearCliente({ baseUrl: "http://api", fetch });
    await c.pedir("/api/yo/telegram/vinculo", { metodo: "POST" });
    const h = llamadas[0]?.init.headers as Record<string, string>;
    expect(h["content-type"]).toBeUndefined();
    expect(llamadas[0]?.init.body).toBeUndefined();
  });

  it("un POST con cuerpo lo serializa y declara JSON", async () => {
    const { llamadas, fetch } = conRespuesta(new Response(null, { status: 204 }));
    await crearCliente({ baseUrl: "http://api", fetch }).pedir("/api/espacios", {
      metodo: "POST",
      cuerpo: { nombre: "Casa" },
    });
    const h = llamadas[0]?.init.headers as Record<string, string>;
    expect(h["content-type"]).toBe("application/json");
    expect(llamadas[0]?.init.body).toBe('{"nombre":"Casa"}');
  });

  it("traduce el error de la API a ErrorApi con su código de dominio", async () => {
    const { fetch } = conRespuesta(
      json({ codigo: "limite_espacios", mensaje: "Alcanzaste el máximo de espacios" }, 409),
    );
    const error = await crearCliente({ baseUrl: "http://api", fetch })
      .pedir("/api/espacios", { metodo: "POST", cuerpo: {} })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error).toMatchObject({ status: 409, codigo: "limite_espacios" });
  });

  it("un error sin el formato esperado no filtra el cuerpo", async () => {
    const { fetch } = conRespuesta(new Response("<html>boom</html>", { status: 502 }));
    const error = (await crearCliente({ baseUrl: "http://api", fetch })
      .pedir("/health")
      .catch((e: unknown) => e)) as ErrorApi;
    expect(error).toMatchObject({ status: 502, codigo: "desconocido", message: "Algo salió mal" });
  });

  it("sin red responde SinConexion, no un error de la API", async () => {
    const { fetch } = conRespuesta(new TypeError("Failed to fetch"));
    const error = await crearCliente({ baseUrl: "http://api", fetch })
      .pedir("/health")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SinConexion);
  });

  it("una respuesta que no cumple el contrato falla en vez de pasar datos a medias", async () => {
    const { fetch } = conRespuesta(json({ estado: "ok" }));
    await expect(
      crearCliente({ baseUrl: "http://api", fetch }).pedir("/health", { esquema: respuestaHealth }),
    ).rejects.toThrow();
  });

  it("el flujo SSE pide text/event-stream con el Bearer", async () => {
    const { llamadas, fetch } = conRespuesta(new Response("", { status: 200 }));
    const c = crearCliente({ baseUrl: "http://api", obtenerToken: async () => "tok", fetch });
    await c.abrirFlujo("/api/espacios/x/eventos", new AbortController().signal);
    const h = llamadas[0]?.init.headers as Record<string, string>;
    expect(h.accept).toBe("text/event-stream");
    expect(h.authorization).toBe("Bearer tok");
  });
});
