import { describe, expect, it } from "vitest";
import { ackComandoV1, comandoV1, configV1, parsearTopico, telemetria, topico } from "./mqtt.ts";

const ID = "0192f3a7-5d1c-7a2b-8c3d-0123456789ab";

describe("telemetria", () => {
  it("acepta un payload v1 completo", () => {
    const r = telemetria.safeParse({
      v: 1,
      ts: 1760150400,
      seq: 1832,
      ph: 7.12,
      t: 22.4,
      ec: 480,
      turb: 0.8,
      tds: 310,
    });
    expect(r.success).toBe(true);
  });

  it("acepta mediciones ausentes o nulas (sensor caído)", () => {
    expect(telemetria.safeParse({ v: 1, ts: 1760150400, seq: 1, ph: null }).success).toBe(true);
  });

  it("rechaza campos desconocidos", () => {
    expect(telemetria.safeParse({ v: 1, ts: 1760150400, seq: 1, extra: 1 }).success).toBe(false);
  });

  it("rechaza versiones no soportadas, ts no entero y NaN", () => {
    expect(telemetria.safeParse({ v: 9, ts: 1760150400, seq: 1 }).success).toBe(false);
    expect(telemetria.safeParse({ v: 1, ts: 1.5, seq: 1 }).success).toBe(false);
    expect(telemetria.safeParse({ v: 1, ts: 1760150400, seq: 1, ph: Number.NaN }).success).toBe(
      false,
    );
  });
});

describe("tópicos", () => {
  it("ida y vuelta", () => {
    expect(parsearTopico(topico(ID, "telemetry"))).toEqual({ deviceId: ID, tipo: "telemetry" });
    expect(parsearTopico(topico(ID, "cmd/ack"))).toEqual({ deviceId: ID, tipo: "cmd/ack" });
  });

  it("rechaza tópicos ajenos o mal formados", () => {
    expect(parsearTopico("otro/v1/d/x/telemetry")).toBeNull();
    expect(parsearTopico("lympha/v1/d/no-es-uuid/telemetry")).toBeNull();
    expect(parsearTopico(`lympha/v1/d/${ID}/desconocido`)).toBeNull();
    expect(parsearTopico(`lympha/v1/d/${ID}`)).toBeNull();
  });
});

describe("comandos, ack y config", () => {
  const sha = "a".repeat(64);

  it("acepta reboot y ota", () => {
    expect(comandoV1.safeParse({ v: 1, id: "c1", op: "reboot" }).success).toBe(true);
    expect(
      comandoV1.safeParse({
        v: 1,
        id: "c2",
        op: "ota",
        url: "http://192.168.1.50:8080/fw/1.1.0.bin",
        sha256: sha,
        version: "1.1.0",
      }).success,
    ).toBe(true);
  });

  it("rechaza ota sin hash válido, ops desconocidas y campos extra", () => {
    const ota = { v: 1, id: "c2", op: "ota", url: "http://x.test/f.bin", version: "1.1.0" };
    expect(comandoV1.safeParse({ ...ota, sha256: "xyz" }).success).toBe(false);
    expect(comandoV1.safeParse({ v: 1, id: "c3", op: "formatear" }).success).toBe(false);
    expect(comandoV1.safeParse({ v: 1, id: "c1", op: "reboot", extra: 1 }).success).toBe(false);
  });

  it("valida el ack", () => {
    expect(
      ackComandoV1.safeParse({ v: 1, id: "c1", ok: true, detail: "reiniciando" }).success,
    ).toBe(true);
    expect(ackComandoV1.safeParse({ v: 1, id: "c1" }).success).toBe(false);
  });

  it("valida la configuración y rechaza intervalos absurdos y parámetros desconocidos", () => {
    const cfg = {
      v: 1,
      intervalo_s: 60,
      led: { umbrales: { ph: { buena: { min: 6.5, max: 8.5 }, regular: { min: 6, max: 9 } } } },
    };
    expect(configV1.safeParse(cfg).success).toBe(true);
    expect(configV1.safeParse({ ...cfg, intervalo_s: 1 }).success).toBe(false);
    expect(
      configV1.safeParse({ v: 1, intervalo_s: 60, led: { umbrales: { cloro: {} } } }).success,
    ).toBe(false);
  });
});
