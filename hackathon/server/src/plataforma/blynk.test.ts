import { describe, expect, it } from "vitest";
import { BlynkError, crearClienteBlynk } from "./blynk.ts";

const TOKEN = "token-secreto-de-prueba";

function falso(respuesta: () => Response | Promise<Response>) {
  const llamadas: URL[] = [];
  const fakeFetch = (async (url: URL | string) => {
    llamadas.push(new URL(String(url)));
    return respuesta();
  }) as typeof fetch;
  return { llamadas, cliente: crearClienteBlynk({ host: "blynk.cloud", fetch: fakeFetch }) };
}

describe("escribirPines", () => {
  it("manda todos los pines en una sola petición a /batch/update", async () => {
    const { cliente, llamadas } = falso(() => new Response(null, { status: 200 }));
    await cliente.escribirPines(TOKEN, { V2: 7.12, v6: 42 });
    expect(llamadas).toHaveLength(1);
    const u = llamadas[0] as URL;
    expect(u.host).toBe("blynk.cloud");
    expect(u.pathname).toBe("/external/api/batch/update");
    expect(u.searchParams.get("token")).toBe(TOKEN);
    expect(u.searchParams.get("v2")).toBe("7.12");
    expect(u.searchParams.get("v6")).toBe("42");
  });

  it("rechaza pines inválidos, valores no finitos y peticiones vacías sin llamar a la red", async () => {
    const { cliente, llamadas } = falso(() => new Response(null, { status: 200 }));
    await expect(cliente.escribirPines(TOKEN, { x2: 1 })).rejects.toThrow(/Pin inválido/);
    await expect(cliente.escribirPines(TOKEN, { v2: Number.NaN })).rejects.toThrow(/finito/);
    await expect(cliente.escribirPines(TOKEN, {})).rejects.toThrow(/No hay pines/);
    expect(llamadas).toHaveLength(0);
  });

  it("un error de Blynk no filtra el token ni la URL", async () => {
    const { cliente } = falso(() => new Response("Invalid token.", { status: 400 }));
    const e = await cliente.escribirPines(TOKEN, { v2: 7 }).catch((x) => x);
    expect(e).toBeInstanceOf(BlynkError);
    expect(e.estado).toBe(400);
    expect(String(e.message)).not.toContain(TOKEN);
    expect(String(e.message)).not.toContain("blynk.cloud");
  });

  it("si la red falla, el error es genérico y tipado", async () => {
    const cliente = crearClienteBlynk({
      host: "blynk.cloud",
      fetch: (async () => {
        throw new TypeError(`fetch failed https://blynk.cloud/?token=${TOKEN}`);
      }) as typeof fetch,
    });
    const e = await cliente.escribirPines(TOKEN, { v2: 7 }).catch((x) => x);
    expect(e).toBeInstanceOf(BlynkError);
    expect(String(e.message)).not.toContain(TOKEN);
  });
});

describe("leerTodo", () => {
  it("devuelve el JSON plano de getAll", async () => {
    const { cliente, llamadas } = falso(
      () => new Response(JSON.stringify({ v2: 7.1, v6: 3, v1: 25.0 }), { status: 200 }),
    );
    expect(await cliente.leerTodo(TOKEN)).toEqual({ v2: 7.1, v6: 3, v1: 25 });
    expect((llamadas[0] as URL).pathname).toBe("/external/api/getAll");
  });

  it("rechaza una respuesta con forma inesperada", async () => {
    const { cliente } = falso(() => new Response("[1,2]", { status: 200 }));
    await expect(cliente.leerTodo(TOKEN)).rejects.toThrow(/forma inesperada/);
    const { cliente: c2 } = falso(() => new Response("no es json", { status: 200 }));
    await expect(c2.leerTodo(TOKEN)).rejects.toThrow(/forma inesperada/);
  });
});

describe("nodoConectado", () => {
  it("interpreta true y false", async () => {
    expect(await falso(() => new Response("true")).cliente.nodoConectado(TOKEN)).toBe(true);
    expect(await falso(() => new Response("false")).cliente.nodoConectado(TOKEN)).toBe(false);
  });
});
