import { describe, expect, it } from "vitest";
import { crearServidorHttp } from "./http.ts";
import { crearLogger } from "./logger.ts";

const PWA = "https://app.example.com";

async function servidor(origenesCors?: string[]) {
  const app = crearServidorHttp(
    crearLogger("prueba", "silent"),
    origenesCors ? { origenesCors } : {},
  );
  app.get("/api/prueba", async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe("CORS", () => {
  it("el preflight de un origen permitido responde 204 con métodos y cabeceras, sin credenciales", async () => {
    const app = await servidor([PWA]);
    const r = await app.inject({
      method: "OPTIONS",
      url: "/api/prueba",
      headers: {
        origin: PWA,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization",
      },
    });
    expect(r.statusCode).toBe(204);
    expect(r.headers["access-control-allow-origin"]).toBe(PWA);
    expect(r.headers["access-control-allow-methods"]).toContain("PATCH");
    expect(r.headers["access-control-allow-headers"]).toContain("authorization");
    expect(r.headers["access-control-allow-credentials"]).toBeUndefined();
    await app.close();
  });

  it("una respuesta normal a un origen permitido lleva el origen exacto y Vary: Origin", async () => {
    const app = await servidor([PWA, "http://localhost:5173"]);
    const r = await app.inject({
      method: "GET",
      url: "/api/prueba",
      headers: { origin: "http://localhost:5173" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(r.headers.vary).toContain("Origin");
    await app.close();
  });

  it("un origen ajeno no recibe cabeceras CORS, ni en la respuesta ni en el preflight", async () => {
    const app = await servidor([PWA]);
    for (const origin of ["https://malo.example.com", "https://app.example.com.malo.com", "null"]) {
      const normal = await app.inject({ method: "GET", url: "/api/prueba", headers: { origin } });
      expect(normal.headers["access-control-allow-origin"]).toBeUndefined();
      const previo = await app.inject({
        method: "OPTIONS",
        url: "/api/prueba",
        headers: { origin, "access-control-request-method": "GET" },
      });
      expect(previo.statusCode).not.toBe(204);
      expect(previo.headers["access-control-allow-origin"]).toBeUndefined();
    }
    await app.close();
  });

  it("sin orígenes configurados, CORS está apagado", async () => {
    const app = await servidor();
    const r = await app.inject({ method: "GET", url: "/api/prueba", headers: { origin: PWA } });
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });
});
