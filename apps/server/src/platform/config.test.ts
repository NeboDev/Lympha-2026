import { describe, expect, it } from "vitest";
import { ConfigInvalida, cargarConfig } from "./config.ts";

const base = { APP_ENV: "local", NODE_ENV: "development" };

describe("cargarConfig", () => {
  it("carga el worker con valores por defecto", () => {
    const c = cargarConfig("worker", {
      ...base,
      DATABASE_URL_SYSTEM: "postgres://u:p@h/db",
      VALKEY_URL: "redis://h:6379",
    });
    expect(c.WORKER_CONCURRENCY).toBe(1);
    expect(c.LOG_LEVEL).toBe("info");
  });

  it("falla si falta una variable y nombra solo la variable, no su valor", () => {
    let error: unknown;
    try {
      cargarConfig("worker", { ...base, DATABASE_URL_SYSTEM: "postgres://u:secreto@h/db" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigInvalida);
    const mensaje = (error as ConfigInvalida).message;
    expect(mensaje).toContain("VALKEY_URL");
    expect(mensaje).not.toContain("secreto");
  });

  it("rechaza URLs con esquema incorrecto sin repetir su valor", () => {
    let mensaje = "";
    try {
      cargarConfig("notifier", { ...base, DATABASE_URL_SYSTEM: "mysql://u:clave@h/db" });
    } catch (e) {
      mensaje = (e as Error).message;
    }
    expect(mensaje).toContain("DATABASE_URL_SYSTEM");
    expect(mensaje).not.toContain("clave");
  });

  it("limita la concurrencia del worker a 1 en el MVP", () => {
    expect(() =>
      cargarConfig("worker", {
        ...base,
        DATABASE_URL_SYSTEM: "postgres://u:p@h/db",
        VALKEY_URL: "redis://h:6379",
        WORKER_CONCURRENCY: "4",
      }),
    ).toThrow(ConfigInvalida);
  });

  it("exige APP_ENV", () => {
    expect(() => cargarConfig("migrate", { DATABASE_URL_MIGRATE: "postgres://u:p@h/db" })).toThrow(
      /APP_ENV/,
    );
  });

  describe("api: Firebase y Telegram", () => {
    const api = {
      DATABASE_URL_APP: "postgres://u:p@h/db",
      VALKEY_URL: "redis://h:6379",
      MQTT_URL: "mqtt://h:1883",
      MQTT_CONTROL_USER: "c",
      MQTT_CONTROL_PASSWORD: "x",
      CLAIM_PEPPER: "p",
      FIREBASE_PROJECT_ID: "lympha-dev",
    };

    it("acepta el emulador de Auth solo con APP_ENV=local", () => {
      const c = cargarConfig("api", {
        ...base,
        ...api,
        FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      });
      expect(c.FIREBASE_AUTH_EMULATOR_HOST).toBe("127.0.0.1:9099");
      for (const APP_ENV of ["staging", "production"]) {
        expect(() =>
          cargarConfig("api", { ...api, APP_ENV, FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" }),
        ).toThrow(/FIREBASE_AUTH_EMULATOR_HOST: solo se permite con APP_ENV=local/);
      }
    });

    it("exige FIREBASE_PROJECT_ID", () => {
      const { FIREBASE_PROJECT_ID: _omitida, ...sin } = api;
      expect(() => cargarConfig("api", { ...base, ...sin })).toThrow(/FIREBASE_PROJECT_ID/);
    });

    it("trata una variable opcional vacía como ausente", () => {
      const c = cargarConfig("api", {
        ...base,
        ...api,
        PUBLIC_API_URL: "",
        TELEGRAM_BOT_TOKEN: "",
        FIREBASE_AUTH_EMULATOR_HOST: "",
      });
      expect(c.PUBLIC_API_URL).toBeUndefined();
      expect(c.TELEGRAM_BOT_TOKEN).toBeUndefined();
      expect(c.FIREBASE_AUTH_EMULATOR_HOST).toBeUndefined();
    });

    it("en local, Telegram funciona sin PUBLIC_API_URL (long polling)", () => {
      expect(() =>
        cargarConfig("api", { ...base, ...api, TELEGRAM_BOT_TOKEN: "123:abc" }),
      ).not.toThrow();
    });

    it("fuera de local, Telegram exige PUBLIC_API_URL https y el secreto del webhook", () => {
      const prod = { ...api, APP_ENV: "production", TELEGRAM_BOT_TOKEN: "123:abc" };
      expect(() => cargarConfig("api", prod)).toThrow(/PUBLIC_API_URL: falta/);
      expect(() =>
        cargarConfig("api", { ...prod, PUBLIC_API_URL: "http://api.example.com" }),
      ).toThrow(/https/);
      expect(() =>
        cargarConfig("api", { ...prod, PUBLIC_API_URL: "https://api.example.com" }),
      ).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
      expect(() =>
        cargarConfig("api", {
          ...prod,
          PUBLIC_API_URL: "https://api.example.com",
          TELEGRAM_WEBHOOK_SECRET: "secreto-de-prueba-largo",
        }),
      ).not.toThrow();
    });

    it("en local, definir PUBLIC_API_URL activa el webhook y entonces exige el secreto", () => {
      expect(() =>
        cargarConfig("api", {
          ...base,
          ...api,
          TELEGRAM_BOT_TOKEN: "123:abc",
          PUBLIC_API_URL: "https://abc.ngrok.app",
        }),
      ).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
    });
  });
});
