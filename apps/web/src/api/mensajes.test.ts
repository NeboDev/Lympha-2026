import { describe, expect, it } from "vitest";
import { ErrorApi, SinConexion } from "./cliente.ts";
import { mensajeDeError } from "./mensajes.ts";

describe("mensajeDeError", () => {
  it("traduce los códigos de dominio conocidos", () => {
    expect(mensajeDeError(new ErrorApi(404, "reclamo_invalido", "x"))).toMatch(/reclamar ese nodo/);
    expect(mensajeDeError(new ErrorApi(409, "transferir_primero", "x"))).toMatch(/Transfiere/);
    expect(mensajeDeError(new ErrorApi(429, "demasiadas_solicitudes", "x"))).toMatch(/Demasiados/);
  });

  it("distingue la falta de red de un error de la API", () => {
    expect(mensajeDeError(new SinConexion())).toMatch(/No hay conexión/);
  });

  it("un código desconocido o un error cualquiera dan un mensaje genérico sin exponer nada interno", () => {
    for (const raro of [
      new ErrorApi(500, "error_interno", "boom: stack"),
      new Error("boom"),
      "x",
    ]) {
      const m = mensajeDeError(raro);
      expect(m).toBe("Algo salió mal. Inténtalo de nuevo.");
    }
  });

  it("ningún mensaje dice «potable» ni «seguro» (RNF-32)", () => {
    for (const codigo of [
      "reclamo_invalido",
      "invitacion_invalida",
      "limite_espacios",
      "transferir_primero",
      "demasiadas_solicitudes",
      "prohibido",
      "no_encontrado",
      "no_autenticado",
      "conflicto",
      "invalido",
      "otro",
    ]) {
      expect(mensajeDeError(new ErrorApi(400, codigo, "x"))).not.toMatch(/potable|seguro/i);
    }
  });
});
