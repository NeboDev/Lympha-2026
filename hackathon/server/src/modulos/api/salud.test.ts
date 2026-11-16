import { describe, expect, it } from "vitest";
import { crearApp } from "./index.ts";

function app(mongo: () => Promise<boolean>, blynk: () => Promise<boolean>) {
  return crearApp({ corsOrigenes: ["http://localhost:5173"], salud: { mongo, blynk } });
}

describe("GET /api/salud", () => {
  it("todo bien: ok true", async () => {
    const r = await app(
      async () => true,
      async () => true,
    ).inject("/api/salud");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, mongo: true, blynk: true });
  });

  it("Mongo caído: 200 con mongo false", async () => {
    const r = await app(
      async () => false,
      async () => true,
    ).inject("/api/salud");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: false, mongo: false, blynk: true });
  });

  it("una dependencia que lanza error cuenta como caída", async () => {
    const r = await app(
      async () => {
        throw new Error("boom");
      },
      async () => true,
    ).inject("/api/salud");
    expect(r.json().mongo).toBe(false);
  });
});

describe("api general", () => {
  const a = app(
    async () => true,
    async () => true,
  );

  it("ruta desconocida: 404 sin detalles", async () => {
    const r = await a.inject("/api/nada");
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: "no_encontrado" });
  });

  it("CORS: permite solo los orígenes configurados", async () => {
    const ok = await a.inject({ url: "/api/salud", headers: { origin: "http://localhost:5173" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const mal = await a.inject({ url: "/api/salud", headers: { origin: "http://evil.test" } });
    expect(mal.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("CORS: responde el preflight con 204", async () => {
    const r = await a.inject({
      method: "OPTIONS",
      url: "/api/salud",
      headers: { origin: "http://localhost:5173" },
    });
    expect(r.statusCode).toBe(204);
  });
});
