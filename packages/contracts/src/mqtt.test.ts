import { describe, expect, it } from "vitest";
import { parsearTopico, telemetria, topico } from "./mqtt.ts";

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
