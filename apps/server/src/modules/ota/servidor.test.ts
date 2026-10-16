import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearServidorOta } from "./servidor.ts";

let dir: string;
let base: string;
const servidor = (() => {
  dir = mkdtempSync(join(tmpdir(), "lympha-ota-"));
  return crearServidorOta(dir);
})();

beforeAll(async () => {
  writeFileSync(join(dir, "lympha-1.1.0.bin"), Buffer.from("firmware de prueba"));
  writeFileSync(join(dir, "secreto.txt"), "no debe salir");
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => servidor.close(r));
  rmSync(dir, { recursive: true, force: true });
});

describe("servidor OTA", () => {
  it("sirve un binario registrado con su tamaño", async () => {
    const r = await fetch(`${base}/fw/lympha-1.1.0.bin`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-length")).toBe(String("firmware de prueba".length));
    expect(Buffer.from(await r.arrayBuffer()).toString()).toBe("firmware de prueba");
  });

  it("no sirve otros archivos ni rutas fuera de la carpeta", async () => {
    for (const ruta of [
      "/fw/secreto.txt",
      "/fw/../secreto.txt",
      "/fw/%2e%2e/secreto.txt",
      "/fw/lympha-9.9.9.bin",
      "/otro",
      "/",
    ]) {
      expect((await fetch(`${base}${ruta}`)).status, ruta).toBe(404);
    }
  });

  it("solo atiende GET", async () => {
    expect((await fetch(`${base}/fw/lympha-1.1.0.bin`, { method: "POST" })).status).toBe(404);
  });
});
