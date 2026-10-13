import { afterEach, describe, expect, it } from "vitest";
import { parsearCuentaServicio } from "../../platform/config.ts";
import { prepararEntornoFirebase } from "./verificador.ts";

const cuenta = {
  project_id: "lympha-dev",
  client_email: "firebase-adminsdk@lympha-dev.iam.gserviceaccount.com",
  private_key: "clave-de-prueba",
};

describe("parsearCuentaServicio", () => {
  it("lee JSON y base64 de JSON", () => {
    const json = JSON.stringify(cuenta);
    expect(parsearCuentaServicio(json)).toMatchObject({ ok: true, cuenta });
    expect(parsearCuentaServicio(Buffer.from(json).toString("base64"))).toMatchObject({
      ok: true,
      cuenta,
    });
  });

  it("no devuelve el contenido en los motivos de error", () => {
    const r = parsearCuentaServicio(JSON.stringify({ project_id: "x", private_key: "SECRETO" }));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("SECRETO");
  });
});

describe("prepararEntornoFirebase", () => {
  const original = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  afterEach(() => {
    if (original === undefined) delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    else process.env.FIREBASE_AUTH_EMULATOR_HOST = original;
  });

  it("con el emulador activo fija la dirección configurada", () => {
    prepararEntornoFirebase({
      FIREBASE_USE_EMULATOR: true,
      FIREBASE_AUTH_EMULATOR_HOST: "firebase-auth:9099",
    });
    expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBe("firebase-auth:9099");
  });

  it("sin él borra una variable suelta, para que firebase-admin nunca use el emulador por accidente", () => {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
    prepararEntornoFirebase({
      FIREBASE_USE_EMULATOR: false,
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    });
    expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBeUndefined();
  });
});
