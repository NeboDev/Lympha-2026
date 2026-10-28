import { describe, expect, it } from "vitest";
import {
  debeRecordar,
  decidirNivel,
  decidirSensor,
  esAvisable,
  horasRecordatorio,
  minutosSinConexion,
  SIN_CONEXION_MIN_DEFECTO,
} from "./reglas.ts";

describe("alarma de nivel", () => {
  it("sin alarma abierta: buena y sin_datos no hacen nada; regular o peor abren", () => {
    expect(decidirNivel(null, "buena")).toEqual({ tipo: "ninguna" });
    expect(decidirNivel(null, "sin_datos")).toEqual({ tipo: "ninguna" });
    expect(decidirNivel(null, "regular")).toEqual({ tipo: "abrir", severidad: "regular" });
    expect(decidirNivel(null, "critica")).toEqual({ tipo: "abrir", severidad: "critica" });
  });

  it("con alarma abierta: empeorar escala, mejorar sin llegar a buena mejora, buena resuelve", () => {
    expect(decidirNivel("mala", "critica")).toEqual({
      tipo: "escalar",
      severidad: "critica",
      anterior: "mala",
    });
    expect(decidirNivel("critica", "regular")).toEqual({
      tipo: "mejorar",
      severidad: "regular",
      anterior: "critica",
    });
    expect(decidirNivel("regular", "buena")).toEqual({ tipo: "resolver", anterior: "regular" });
  });

  it("el mismo nivel no repite nada (RF-30) y sin_datos no resuelve ni mejora", () => {
    expect(decidirNivel("mala", "mala")).toEqual({ tipo: "ninguna" });
    expect(decidirNivel("mala", "sin_datos")).toEqual({ tipo: "ninguna" });
  });

  it("es idempotente: aplicar la acción y volver a evaluar no produce otra acción", () => {
    const secuencia = ["regular", "mala", "mala", "critica", "mala", "buena", "buena"] as const;
    let abierta: "regular" | "mala" | "critica" | null = null;
    const acciones: string[] = [];
    for (const nivel of secuencia) {
      const a = decidirNivel(abierta, nivel);
      acciones.push(a.tipo);
      if (a.tipo === "abrir" || a.tipo === "escalar" || a.tipo === "mejorar") abierta = a.severidad;
      if (a.tipo === "resolver") abierta = null;
      expect(decidirNivel(abierta, nivel)).toEqual({ tipo: "ninguna" });
    }
    expect(acciones).toEqual([
      "abrir",
      "escalar",
      "ninguna",
      "escalar",
      "mejorar",
      "resolver",
      "ninguna",
    ]);
  });
});

describe("alarma de sensor", () => {
  it("abre con revisar, cierra con ok y no se mueve con dudosa", () => {
    expect(decidirSensor(false, "revisar")).toBe("abrir");
    expect(decidirSensor(false, "dudosa")).toBe("ninguna");
    expect(decidirSensor(false, "ok")).toBe("ninguna");
    expect(decidirSensor(true, "revisar")).toBe("ninguna");
    expect(decidirSensor(true, "dudosa")).toBe("ninguna");
    expect(decidirSensor(true, "ok")).toBe("resolver");
  });
});

describe("tiempos", () => {
  const ahora = Date.UTC(2026, 9, 13, 12, 0, 0);

  it("no avisa de lecturas con más de 30 min", () => {
    expect(esAvisable(ahora - 29 * 60_000, ahora)).toBe(true);
    expect(esAvisable(ahora - 31 * 60_000, ahora)).toBe(false);
    expect(esAvisable(ahora - 3 * 3_600_000, ahora, 240)).toBe(true);
  });

  it("horas de recordatorio: la crítica baja a 2 h solo si el usuario sigue en el valor por defecto", () => {
    expect(horasRecordatorio(null, "nivel", "critica")).toBe(2);
    expect(horasRecordatorio(6, "nivel", "critica")).toBe(2);
    expect(horasRecordatorio(12, "nivel", "critica")).toBe(12);
    expect(horasRecordatorio(1, "nivel", "critica")).toBe(1);
    expect(horasRecordatorio(null, "nivel", "mala")).toBe(6);
    expect(horasRecordatorio(null, "sin_conexion", "regular")).toBe(6);
    expect(horasRecordatorio(null, "sensor", "critica")).toBe(6);
  });

  it("recordatorio: solo al cumplirse las horas desde el último aviso", () => {
    expect(debeRecordar(ahora - 5.9 * 3_600_000, ahora, 6)).toBe(false);
    expect(debeRecordar(ahora - 6 * 3_600_000, ahora, 6)).toBe(true);
    expect(debeRecordar(ahora - 3_600_000, ahora, 1)).toBe(true);
  });

  it("minutos sin conexión: lee la regla del perfil y cae al valor por defecto", () => {
    expect(minutosSinConexion({ sin_conexion_min: 3 })).toBe(3);
    expect(minutosSinConexion({ pendiente: true })).toBe(SIN_CONEXION_MIN_DEFECTO);
    expect(minutosSinConexion({ sin_conexion_min: 0 })).toBe(SIN_CONEXION_MIN_DEFECTO);
    expect(minutosSinConexion({ sin_conexion_min: "10" })).toBe(SIN_CONEXION_MIN_DEFECTO);
    expect(minutosSinConexion(null)).toBe(SIN_CONEXION_MIN_DEFECTO);
  });
});
