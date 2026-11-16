import { describe, expect, it } from "vitest";
import { parametroDe } from "../dominio/catalogo.ts";
import { type Estado, evaluar, type Lectura } from "../modulos/evaluacion/index.ts";
import { cargarCatalogo } from "../plataforma/catalogo.ts";
import {
  descripcionDe,
  duracionDe,
  esEscenario,
  estadoNodo,
  muestra,
  NOMBRES_ESCENARIOS,
  type NombreEscenario,
} from "./escenarios.ts";

const ph = parametroDe(cargarCatalogo(), "ph");
function exigir<T>(valor: T | null | undefined, mensaje: string): T {
  if (valor === null || valor === undefined) throw new Error(mensaje);
  return valor;
}
const reglas = exigir(ph.reglas, "El catálogo de pH debe traer reglas");
const normaCatalogo = exigir(ph.norma, "El catálogo de pH debe traer norma");
const norma = {
  min: exigir(normaCatalogo.min, "falta el límite mínimo"),
  max: exigir(normaCatalogo.max, "falta el límite máximo"),
};

const T0 = Date.UTC(2026, 10, 19, 15, 0, 0);
const PASO_S = 5; // como POLL_MS de la demo
const VENTANA = 80; // lecturas (400 s) que el worker daría a la evaluación

/** Recorre un escenario como lo haría el servidor: ventana móvil + estado previo. */
function correr(nombre: NombreEscenario, hastaS: number) {
  const lecturas: Lectura[] = [];
  const secuencia: Estado[] = [];
  let previo: Estado | null = null;
  let ultimo: ReturnType<typeof evaluar> | null = null;
  let sinEscribir = 0;
  for (let t = 0; t <= hastaS; t += PASO_S) {
    const m = muestra(nombre, t, norma);
    if (!m.escribe) {
      sinEscribir++;
      continue;
    }
    lecturas.push({ ts: new Date(T0 + t * 1000), valor: m.ph });
    ultimo = evaluar({
      norma,
      reglas,
      ventana: lecturas.slice(-VENTANA),
      previo,
      estadoNodo: m.estado,
    });
    previo = ultimo.estado;
    if (secuencia[secuencia.length - 1] !== previo) secuencia.push(previo);
  }
  return { secuencia, ultimo, sinEscribir };
}

describe("muestra", () => {
  it("es determinista", () => {
    for (const n of NOMBRES_ESCENARIOS) {
      expect(muestra(n, 123, norma)).toEqual(muestra(n, 123, norma));
    }
  });

  it("el pH filtrado casi no tiene ruido y el crudo sí", () => {
    let maxFiltrado = 0;
    let maxCrudo = 0;
    for (let t = 0; t < 60; t += 5) {
      const m = muestra("estable", t, norma);
      maxFiltrado = Math.max(maxFiltrado, Math.abs(m.ph - 7.2));
      maxCrudo = Math.max(maxCrudo, Math.abs(m.phCrudo - 7.2));
    }
    expect(maxFiltrado).toBeLessThanOrEqual(0.0101);
    expect(maxCrudo).toBeGreaterThan(maxFiltrado);
    expect(maxCrudo).toBeLessThanOrEqual(0.0801);
  });

  it("siempre devuelve un pH físicamente posible (0–14)", () => {
    for (const n of NOMBRES_ESCENARIOS) {
      for (let t = 0; t < 900; t += 7) {
        const m = muestra(n, t, norma);
        expect(m.ph).toBeGreaterThanOrEqual(0);
        expect(m.ph).toBeLessThanOrEqual(14);
        expect(m.phCrudo).toBeLessThanOrEqual(14);
      }
    }
  });

  it("cada escenario tiene descripción y duración", () => {
    for (const n of NOMBRES_ESCENARIOS) {
      expect(descripcionDe(n).length).toBeGreaterThan(10);
      expect(duracionDe(n)).toBeGreaterThan(0);
    }
    expect(esEscenario("pico")).toBe(true);
    expect(esEscenario("otro")).toBe(false);
  });
});

describe("estado del nodo (V4)", () => {
  it("0 ok · 1 atención · 2 fuera de rango · 3 error de sensor", () => {
    expect(estadoNodo(7.2, true, norma)).toBe(0);
    expect(estadoNodo(6.7, true, norma)).toBe(1);
    expect(estadoNodo(8.4, true, norma)).toBe(1);
    expect(estadoNodo(6.2, true, norma)).toBe(2);
    expect(estadoNodo(9.1, true, norma)).toBe(2);
    expect(estadoNodo(7.2, false, norma)).toBe(3);
  });
});

// Cada historia pasa por la evaluación real del Paso 2 y tiene un nivel esperado.
describe("historias de punta a punta con la evaluación", () => {
  it("estable: siempre en rango y termina estable", () => {
    const r = correr("estable", 300);
    expect(r.secuencia).toEqual(["en_rango"]);
    expect(r.ultimo?.estable).toBe(true);
  });

  it("acidificación: atención → fuera de rango → crítico y vuelve al rango", () => {
    const r = correr("acidificacion", 900);
    expect(r.secuencia).toEqual([
      "en_rango",
      "atencion",
      "fuera_de_rango",
      "critico",
      "fuera_de_rango",
      "atencion",
      "en_rango",
    ]);
  });

  it("pico: solo atención por cambio rápido, nunca fuera de rango, y se calma", () => {
    const r = correr("pico", 600);
    expect(r.secuencia).toEqual(["en_rango", "atencion", "en_rango"]);
  });

  it("sensor desconectado: termina en «revisar sensor» por riel y por el nodo", () => {
    const r = correr("sensor_desconectado", 300);
    expect(r.secuencia).toEqual(["en_rango", "revisar_sensor"]);
    expect(r.ultimo?.motivosSensor).toEqual(expect.arrayContaining(["riel", "nodo"]));
  });

  it("nodo detenido: no escribe entre 60 s y 240 s y no inventa estados", () => {
    const r = correr("nodo_detenido", 360);
    expect(r.sinEscribir).toBe((240 - 60) / PASO_S);
    expect(r.secuencia).toEqual(["en_rango"]);
    expect(muestra("nodo_detenido", 59, norma).escribe).toBe(true);
    expect(muestra("nodo_detenido", 60, norma).escribe).toBe(false);
    expect(muestra("nodo_detenido", 240, norma).escribe).toBe(true);
  });
});
