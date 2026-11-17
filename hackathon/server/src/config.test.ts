import { describe, expect, it } from "vitest";
import { cargarConfig } from "./config.ts";

const CLAVE = Buffer.alloc(32, 7).toString("base64");
const base = { MONGODB_URI: "mongodb://127.0.0.1:27017/atl", ATL_CLAVE_CIFRADO: CLAVE };

describe("cargarConfig", () => {
  it("exige una clave de cifrado de 32 bytes", () => {
    expect(() => cargarConfig({ MONGODB_URI: base.MONGODB_URI })).toThrow(/ATL_CLAVE_CIFRADO/);
    expect(() =>
      cargarConfig({ ...base, ATL_CLAVE_CIFRADO: Buffer.alloc(16).toString("base64") }),
    ).toThrow(/32 bytes/);
    expect(cargarConfig(base).claveCifrado).toHaveLength(32);
  });

  it("Telegram es opcional; con token exige el usuario del bot y valida el formato", () => {
    const c = cargarConfig(base);
    expect(c.telegramToken).toBeNull();
    expect(c.telegramUsuario).toBeNull();
    expect(c.recordatorioMin).toBe(30);
    expect(c.barridoMs).toBe(15000);

    const token = `123456789:${"A".repeat(35)}`;
    expect(() => cargarConfig({ ...base, TELEGRAM_BOT_TOKEN: token })).toThrow(
      /TELEGRAM_BOT_USERNAME/,
    );
    expect(() => cargarConfig({ ...base, TELEGRAM_BOT_TOKEN: "no-es-un-token" })).toThrow(
      /BotFather/,
    );
    expect(() =>
      cargarConfig({ ...base, TELEGRAM_BOT_TOKEN: token, TELEGRAM_BOT_USERNAME: "@mi_bot" }),
    ).toThrow(/sin @/);
    const ok = cargarConfig({
      ...base,
      TELEGRAM_BOT_TOKEN: token,
      TELEGRAM_BOT_USERNAME: "lympha26_bot",
      RECORDATORIO_MIN: "10",
    });
    expect(ok.telegramUsuario).toBe("lympha26_bot");
    expect(ok.recordatorioMin).toBe(10);
  });

  it("el error de configuración no filtra el token", () => {
    try {
      cargarConfig({ ...base, TELEGRAM_BOT_TOKEN: "123456789:secretoinvalido" });
    } catch (e) {
      expect(String(e)).not.toContain("secretoinvalido");
    }
  });

  it("INGESTA_ACTIVA es true por defecto y se puede apagar", () => {
    expect(cargarConfig(base).ingestaActiva).toBe(true);
    expect(cargarConfig({ ...base, INGESTA_ACTIVA: "false" }).ingestaActiva).toBe(false);
    expect(() => cargarConfig({ ...base, INGESTA_ACTIVA: "quizá" })).toThrow();
  });

  it("aplica valores por defecto", () => {
    const c = cargarConfig(base);
    expect(c.puerto).toBe(3000);
    expect(c.mongoDb).toBe("atl");
    expect(c.blynkHost).toBe("blynk.cloud");
    expect(c.pollMs).toBe(5000);
    expect(c.mongoDns).toEqual([]);
  });

  it("no arranca si falta MONGODB_URI", () => {
    expect(() => cargarConfig({})).toThrow(/MONGODB_URI/);
  });

  it("rechaza una URI que no es de mongo", () => {
    expect(() => cargarConfig({ MONGODB_URI: "http://x" })).toThrow(/mongodb/);
  });

  it("recorta comentarios en línea y comillas", () => {
    const c = cargarConfig({
      ...base,
      BLYNK_HOST: "blynk.cloud        # o el regional (fra1.blynk.cloud, etc.)",
      POLL_MS: '"30000"',
    });
    expect(c.blynkHost).toBe("blynk.cloud");
    expect(c.pollMs).toBe(30000);
  });

  it("separa listas de orígenes y de DNS", () => {
    const c = cargarConfig({
      ...base,
      CORS_ORIGINS: "http://a.test, http://b.test",
      MONGODB_DNS: "8.8.8.8,1.1.1.1",
    });
    expect(c.corsOrigenes).toEqual(["http://a.test", "http://b.test"]);
    expect(c.mongoDns).toEqual(["8.8.8.8", "1.1.1.1"]);
  });

  it("trata un valor vacío como ausente", () => {
    const c = cargarConfig({ ...base, MONGODB_DNS: "", PORT: "" });
    expect(c.mongoDns).toEqual([]);
    expect(c.puerto).toBe(3000);
  });

  it("el mensaje de error no incluye valores", () => {
    try {
      cargarConfig({ MONGODB_URI: "secreto-que-no-debe-salir" });
    } catch (e) {
      expect(String(e)).not.toContain("secreto-que-no-debe-salir");
    }
  });
});

describe("cargarConfig: acceso (Firebase) y usuario de demostración", () => {
  it("sin FIREBASE_PROJECT_ID la configuración es válida pero sin acceso (main.ts no arranca la API)", () => {
    expect(cargarConfig(base).firebase).toBeNull();
    expect(cargarConfig(base).demoToken).toBeNull();
  });

  it("valida el id del proyecto y por defecto no usa el emulador", () => {
    expect(() => cargarConfig({ ...base, FIREBASE_PROJECT_ID: "Mi Proyecto" })).toThrow(
      /FIREBASE_PROJECT_ID/,
    );
    expect(cargarConfig({ ...base, FIREBASE_PROJECT_ID: "lympha-atl-1a2b3" }).firebase).toEqual({
      projectId: "lympha-atl-1a2b3",
      usarEmulador: false,
      hostEmulador: "127.0.0.1:9099",
    });
  });

  it("el emulador solo se permite con APP_ENV=local", () => {
    const f = { ...base, FIREBASE_PROJECT_ID: "lympha-atl-1a2b3", FIREBASE_USE_EMULATOR: "true" };
    expect(cargarConfig(f).firebase?.usarEmulador).toBe(true);
    expect(() => cargarConfig({ ...f, APP_ENV: "demo" })).toThrow(
      /solo se permite con APP_ENV=local/,
    );
  });

  it("el usuario de demostración exige APP_ENV=demo y un token largo", () => {
    const d = { ...base, USUARIO_DEMO_ACTIVO: "true" };
    expect(() => cargarConfig(d)).toThrow(/APP_ENV=demo/);
    expect(() => cargarConfig({ ...d, APP_ENV: "demo" })).toThrow(/USUARIO_DEMO_TOKEN/);
    expect(() => cargarConfig({ ...d, APP_ENV: "demo", USUARIO_DEMO_TOKEN: "corto" })).toThrow(
      /16 caracteres/,
    );
    expect(
      cargarConfig({ ...d, APP_ENV: "demo", USUARIO_DEMO_TOKEN: "un-secreto-de-16+chars" })
        .demoToken,
    ).toBe("un-secreto-de-16+chars");
  });

  it("un token de demostración suelto no activa nada", () => {
    expect(
      cargarConfig({ ...base, APP_ENV: "demo", USUARIO_DEMO_TOKEN: "un-secreto-de-16+chars" })
        .demoToken,
    ).toBeNull();
  });
});
