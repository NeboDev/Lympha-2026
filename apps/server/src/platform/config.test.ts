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

    const emulador = {
      FIREBASE_USE_EMULATOR: "true",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    };

    it("acepta el emulador de Auth solo con APP_ENV=local", () => {
      const c = cargarConfig("api", { ...base, ...api, ...emulador });
      expect(c.FIREBASE_USE_EMULATOR).toBe(true);
      expect(c.FIREBASE_AUTH_EMULATOR_HOST).toBe("127.0.0.1:9099");
      for (const APP_ENV of ["staging", "production"]) {
        const e = (() => {
          try {
            cargarConfig("api", { ...api, APP_ENV, ...emulador });
          } catch (error) {
            return (error as Error).message;
          }
          return "";
        })();
        expect(e).toMatch(/FIREBASE_USE_EMULATOR: solo se permite con APP_ENV=local/);
        expect(e).toMatch(/FIREBASE_AUTH_EMULATOR_HOST: solo se permite con APP_ENV=local/);
      }
    });

    it("FIREBASE_USE_EMULATOR es falso por defecto y solo admite true o false", () => {
      expect(cargarConfig("api", { ...base, ...api }).FIREBASE_USE_EMULATOR).toBe(false);
      expect(
        cargarConfig("api", { ...base, ...api, FIREBASE_USE_EMULATOR: "false" })
          .FIREBASE_USE_EMULATOR,
      ).toBe(false);
      expect(
        cargarConfig("api", { ...base, ...api, FIREBASE_USE_EMULATOR: "" }).FIREBASE_USE_EMULATOR,
      ).toBe(false);
      expect(() => cargarConfig("api", { ...base, ...api, FIREBASE_USE_EMULATOR: "yes" })).toThrow(
        /FIREBASE_USE_EMULATOR/,
      );
    });

    it("con el emulador activo exige su dirección", () => {
      expect(() => cargarConfig("api", { ...base, ...api, FIREBASE_USE_EMULATOR: "true" })).toThrow(
        /FIREBASE_AUTH_EMULATOR_HOST: falta/,
      );
    });

    it("con FIREBASE_USE_EMULATOR=false se puede dejar la dirección del emulador sin efecto (Compose)", () => {
      const c = cargarConfig("api", {
        ...base,
        ...api,
        FIREBASE_USE_EMULATOR: "false",
        FIREBASE_AUTH_EMULATOR_HOST: "firebase-auth:9099",
      });
      expect(c.FIREBASE_USE_EMULATOR).toBe(false);
    });

    describe("FIREBASE_SERVICE_ACCOUNT", () => {
      const cuenta = {
        type: "service_account",
        project_id: "lympha-dev",
        client_email: "firebase-adminsdk@lympha-dev.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\nSECRETO-DE-PRUEBA\n-----END PRIVATE KEY-----\n",
      };
      const json = JSON.stringify(cuenta);
      const b64 = Buffer.from(json).toString("base64");

      it("acepta el JSON o su base64 y es opcional", () => {
        expect(() => cargarConfig("api", { ...base, ...api })).not.toThrow();
        expect(() =>
          cargarConfig("api", { ...base, ...api, FIREBASE_SERVICE_ACCOUNT: json }),
        ).not.toThrow();
        expect(() =>
          cargarConfig("api", { ...base, ...api, FIREBASE_SERVICE_ACCOUNT: b64 }),
        ).not.toThrow();
      });

      it("rechaza una cuenta ilegible, incompleta o de otro proyecto sin repetir su contenido", () => {
        for (const malo of [
          "esto no es json",
          JSON.stringify({ project_id: "lympha-dev" }),
          JSON.stringify({ ...cuenta, project_id: "otro-proyecto" }),
        ]) {
          let mensaje = "";
          try {
            cargarConfig("api", { ...base, ...api, FIREBASE_SERVICE_ACCOUNT: malo });
          } catch (e) {
            mensaje = (e as Error).message;
          }
          expect(mensaje).toMatch(/FIREBASE_SERVICE_ACCOUNT/);
          expect(mensaje).not.toContain("SECRETO-DE-PRUEBA");
          expect(mensaje).not.toContain("otro-proyecto");
        }
      });

      it("con el emulador activo se ignora (no se valida)", () => {
        expect(() =>
          cargarConfig("api", { ...base, ...api, ...emulador, FIREBASE_SERVICE_ACCOUNT: "basura" }),
        ).not.toThrow();
      });
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
        FIREBASE_SERVICE_ACCOUNT: "",
      });
      expect(c.PUBLIC_API_URL).toBeUndefined();
      expect(c.TELEGRAM_BOT_TOKEN).toBeUndefined();
      expect(c.FIREBASE_AUTH_EMULATOR_HOST).toBeUndefined();
      expect(c.FIREBASE_SERVICE_ACCOUNT).toBeUndefined();
    });

    it("CORS_ORIGINS: lista de orígenes exactos; vacío = ninguno; sin comodín ni rutas", () => {
      expect(cargarConfig("api", { ...base, ...api }).CORS_ORIGINS).toEqual([]);
      expect(cargarConfig("api", { ...base, ...api, CORS_ORIGINS: "" }).CORS_ORIGINS).toEqual([]);
      expect(
        cargarConfig("api", {
          ...base,
          ...api,
          CORS_ORIGINS: "http://localhost:5173, http://127.0.0.1:5173",
        }).CORS_ORIGINS,
      ).toEqual(["http://localhost:5173", "http://127.0.0.1:5173"]);
      for (const malo of [
        "*",
        "https://app.example.com/",
        "https://app.example.com/x",
        "app.example",
      ]) {
        expect(() => cargarConfig("api", { ...base, ...api, CORS_ORIGINS: malo })).toThrow(
          /CORS_ORIGINS/,
        );
      }
    });

    it("fuera de local, CORS_ORIGINS solo admite https", () => {
      const prod = { ...api, APP_ENV: "production", CORS_ORIGINS: "http://app.example.com" };
      expect(() => cargarConfig("api", prod)).toThrow(/CORS_ORIGINS: fuera de local/);
      expect(
        cargarConfig("api", { ...prod, CORS_ORIGINS: "https://app.example.com" }).CORS_ORIGINS,
      ).toEqual(["https://app.example.com"]);
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

  describe("fabrica", () => {
    const fabrica = {
      DATABASE_URL_MIGRATE: "postgres://u:p@h/db",
      MQTT_URL: "mqtt://h:1883",
      MQTT_ADMIN_USER: "lympha-admin",
      MQTT_ADMIN_PASSWORD: "x",
      CLAIM_PEPPER: "p",
    };

    it("arranca solo con las credenciales de administración de MQTT", () => {
      expect(() => cargarConfig("fabrica", { ...base, ...fabrica })).not.toThrow();
      for (const falta of [
        "MQTT_ADMIN_USER",
        "MQTT_ADMIN_PASSWORD",
        "DATABASE_URL_MIGRATE",
        "CLAIM_PEPPER",
      ]) {
        const { [falta]: _quitada, ...resto } = fabrica as Record<string, string>;
        expect(() => cargarConfig("fabrica", { ...base, ...resto })).toThrow(new RegExp(falta));
      }
    });
  });
});
