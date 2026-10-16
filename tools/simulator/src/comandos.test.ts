import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type ComandoOtaV1, OTA_POR_DEFECTO, resolverOta } from "./comandos.ts";

const bytes = Buffer.from("firmware 1.1.0");
const sha = createHash("sha256").update(bytes).digest("hex");
const cmd: ComandoOtaV1 = {
  v: 1,
  id: "c1",
  op: "ota",
  url: "http://192.168.1.50:8080/fw/lympha-1.1.0.bin",
  sha256: sha,
  version: "1.1.0",
};
const descargaOk = async () => sha;

describe("resolverOta", () => {
  it("éxito: verifica el hash, responde ok y reinicia con la versión nueva", async () => {
    expect(await resolverOta(cmd, OTA_POR_DEFECTO, descargaOk)).toEqual({
      ack: { ok: true, detalle: "reiniciando" },
      luego: "reiniciar_nueva",
    });
  });

  it("hash distinto: responde error y no reinicia", async () => {
    const r = await resolverOta(cmd, OTA_POR_DEFECTO, async () => "0".repeat(64));
    expect(r).toEqual({ ack: { ok: false, detalle: "sha256 distinto" }, luego: "nada" });
  });

  it("descarga fallida: responde error", async () => {
    const r = await resolverOta(cmd, OTA_POR_DEFECTO, async () => {
      throw new Error("HTTP 404");
    });
    expect(r.ack).toEqual({ ok: false, detalle: "descarga fallida: HTTP 404" });
    expect(r.luego).toBe("nada");
  });

  it("sin descarga (pruebas con URL falsa) acepta sin verificar", async () => {
    const r = await resolverOta(cmd, { ...OTA_POR_DEFECTO, descargar: false }, async () => {
      throw new Error("no debe llamarse");
    });
    expect(r.ack?.ok).toBe(true);
  });

  it("rechaza, rollback e ignora", async () => {
    expect(
      (await resolverOta(cmd, { ...OTA_POR_DEFECTO, comportamiento: "rechaza" })).ack?.ok,
    ).toBe(false);
    expect(
      await resolverOta(cmd, { ...OTA_POR_DEFECTO, comportamiento: "rollback" }, descargaOk),
    ).toMatchObject({ ack: { ok: true }, luego: "reiniciar_y_revertir" });
    expect(await resolverOta(cmd, { ...OTA_POR_DEFECTO, comportamiento: "ignora" })).toEqual({
      ack: null,
      luego: "nada",
    });
  });
});
