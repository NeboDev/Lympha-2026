import { describe, expect, it } from "vitest";
import { leerConfig } from "./config.ts";

const completo = {
  VITE_API_URL: "http://localhost:3000/",
  VITE_FIREBASE_API_KEY: "clave-publica",
  VITE_FIREBASE_PROJECT_ID: "lympha-atl-1a2b3",
};

describe("leerConfig", () => {
  it("con todo puesto no falta nada y quita la barra final de la URL", () => {
    const c = leerConfig(completo, false);
    expect(c.problemas).toEqual([]);
    expect(c.apiUrl).toBe("http://localhost:3000");
    expect(c.firebase).toEqual({
      apiKey: "clave-publica",
      authDomain: "lympha-atl-1a2b3.firebaseapp.com",
      projectId: "lympha-atl-1a2b3",
    });
    expect(c.demoToken).toBeNull();
  });

  it("usa el dominio de acceso y el appId si se dan", () => {
    const c = leerConfig(
      {
        ...completo,
        VITE_FIREBASE_AUTH_DOMAIN: "atl.example.mx",
        VITE_FIREBASE_APP_ID: "1:2:web:3",
      },
      false,
    );
    expect(c.firebase).toMatchObject({ authDomain: "atl.example.mx", appId: "1:2:web:3" });
  });

  it("en desarrollo la API tiene un valor por omisión; en producción no", () => {
    expect(leerConfig({}, true).apiUrl).toBe("http://localhost:3000");
    expect(leerConfig({}, false).apiUrl).toBe("");
    expect(leerConfig({}, false).problemas).toContain("VITE_API_URL");
  });

  it("dice qué variables faltan, solo por nombre, y no ofrece Firebase a medias", () => {
    const c = leerConfig({ VITE_API_URL: "http://x" }, false);
    expect(c.problemas).toEqual(["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_PROJECT_ID"]);
    expect(c.firebase).toBeNull();
    expect(leerConfig({ ...completo, VITE_FIREBASE_API_KEY: "  " }, false).firebase).toBeNull();
  });

  it("el token de demostración es opcional", () => {
    expect(leerConfig({ ...completo, VITE_DEMO_TOKEN: " secreto-de-demo " }, false).demoToken).toBe(
      "secreto-de-demo",
    );
    expect(leerConfig({ ...completo, VITE_DEMO_TOKEN: "" }, false).demoToken).toBeNull();
  });
});
