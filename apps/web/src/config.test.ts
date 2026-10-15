import { describe, expect, it } from "vitest";
import { problemasDeConfig, resolverApiUrl, resolverConfigFirebase } from "./config.ts";

describe("resolverApiUrl y problemasDeConfig", () => {
  it("en desarrollo la API tiene valor por omisión y la configuración está completa", () => {
    expect(resolverApiUrl({}, true)).toBe("http://127.0.0.1:3000");
    expect(problemasDeConfig({}, true)).toEqual([]);
  });

  it("quita la barra final de la URL de la API", () => {
    expect(resolverApiUrl({ VITE_API_URL: "https://api.example.com/" }, false)).toBe(
      "https://api.example.com",
    );
  });

  it("un build de producción NO cae a localhost: dice qué variables faltan (solo sus nombres)", () => {
    expect(problemasDeConfig({}, false)).toEqual([
      "VITE_API_URL",
      "VITE_FIREBASE_PROJECT_ID",
      "VITE_FIREBASE_API_KEY",
    ]);
  });

  it("un build de producción completo no tiene problemas, aunque pidan el emulador", () => {
    expect(
      problemasDeConfig(
        {
          VITE_API_URL: "https://api.example.com",
          VITE_FIREBASE_PROJECT_ID: "lympha-prod",
          VITE_FIREBASE_API_KEY: "llave-publica",
          VITE_FIREBASE_AUTH_EMULATOR: "127.0.0.1:9099",
        },
        false,
      ),
    ).toEqual([]);
  });
});

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
