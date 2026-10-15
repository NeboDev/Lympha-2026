import { describe, expect, it } from "vitest";
import { resolverConfigFirebase } from "./config.ts";

describe("resolverConfigFirebase", () => {
  it("en desarrollo usa el emulador y el proyecto lympha-dev sin configurar nada", () => {
    expect(resolverConfigFirebase({}, true)).toEqual({
      apiKey: "emulador",
      authDomain: "lympha-dev.firebaseapp.com",
      projectId: "lympha-dev",
      emulador: "127.0.0.1:9099",
    });
  });

  it("en desarrollo se puede apagar el emulador para usar el proyecto real", () => {
    const c = resolverConfigFirebase(
      { VITE_FIREBASE_AUTH_EMULATOR: "off", VITE_FIREBASE_API_KEY: "llave-publica" },
      true,
    );
    expect(c.emulador).toBeUndefined();
    expect(c.apiKey).toBe("llave-publica");
  });

  it("en producción el emulador se ignora aunque la variable esté definida", () => {
    const c = resolverConfigFirebase(
      {
        VITE_FIREBASE_AUTH_EMULATOR: "127.0.0.1:9099",
        VITE_FIREBASE_PROJECT_ID: "lympha-prod",
        VITE_FIREBASE_API_KEY: "llave-publica",
      },
      false,
    );
    expect(c.emulador).toBeUndefined();
    expect(c).toMatchObject({
      projectId: "lympha-prod",
      authDomain: "lympha-prod.firebaseapp.com",
    });
  });

  it("en producción sin proyecto no inventa uno ni usa la llave del emulador", () => {
    expect(resolverConfigFirebase({}, false)).toMatchObject({
      projectId: "",
      apiKey: "",
      emulador: undefined,
    });
  });
});
