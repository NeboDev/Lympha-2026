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
});
