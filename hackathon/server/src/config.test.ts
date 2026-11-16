import { describe, expect, it } from "vitest";
import { cargarConfig } from "./config.ts";

const base = { MONGODB_URI: "mongodb://127.0.0.1:27017/atl" };

describe("cargarConfig", () => {
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
