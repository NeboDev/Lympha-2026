import { describe, expect, it } from "vitest";
import { decidirTrasError, ESPERAS_S, INTENTOS_MAXIMOS } from "./reintentos.ts";

describe("decisión tras un error de Telegram", () => {
  it("espera 30 s, 2 min, 10 min y 1 h, y al sexto intento falla", () => {
    const esperas = [1, 2, 3, 4, 5].map((n) => decidirTrasError(n, 500, "Internal Server Error"));
    expect(esperas.map((d) => (d.tipo === "reintentar" ? d.esperaS : -1))).toEqual([
      ...ESPERAS_S,
      3600,
    ]);
    expect(decidirTrasError(INTENTOS_MAXIMOS, 500, "x")).toEqual({
      tipo: "fallida",
      motivo: "intentos_agotados",
    });
  });

  it("sin respuesta (red caída o tiempo agotado) se reintenta", () => {
    expect(decidirTrasError(1, undefined, "no se pudo conectar")).toEqual({
      tipo: "reintentar",
      esperaS: 30,
    });
  });

  it("429: respeta la espera que pide Telegram si es mayor que la nuestra", () => {
    expect(decidirTrasError(1, 429, "Too Many Requests", 120)).toEqual({
      tipo: "reintentar",
      esperaS: 121,
    });
    expect(decidirTrasError(2, 429, "Too Many Requests", 5)).toEqual({
      tipo: "reintentar",
      esperaS: 120,
    });
  });

  it("403 y chat perdido descartan (el usuario ya no recibe avisos)", () => {
    expect(decidirTrasError(1, 403, "Forbidden: bot was blocked by the user").tipo).toBe(
      "descartar",
    );
    expect(decidirTrasError(1, 400, "Bad Request: chat not found").tipo).toBe("descartar");
  });

  it("otros 4xx no tienen remedio: fallida de inmediato", () => {
    expect(decidirTrasError(1, 400, "Bad Request: message is too long")).toEqual({
      tipo: "fallida",
      motivo: "rechazado_400",
    });
  });

  it("401 (token mal puesto) se reintenta: es de configuración, no del aviso", () => {
    expect(decidirTrasError(1, 401, "Unauthorized").tipo).toBe("reintentar");
  });
});
