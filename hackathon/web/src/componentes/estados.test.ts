import { describe, expect, it } from "vitest";
import type { Nodo } from "../api/tipos.ts";
import { ESTADOS_UI, type EstadoVisual, estadoVisual } from "./estados.ts";

const ultimo = (estado: NonNullable<Nodo["ultimo"]>["estado"]): Nodo["ultimo"] => ({
  ts: new Date(0),
  v: { ph: 7 },
  estado,
  estados: {},
  estable: true,
  sin_datos: false,
});

describe("estadoVisual", () => {
  it("muestra el estado que evaluó el servidor cuando el nodo envía datos", () => {
    expect(estadoVisual({ conexion: "conectado", ultimo: ultimo("fuera_de_rango") })).toBe(
      "fuera_de_rango",
    );
    expect(estadoVisual({ conexion: "conectado", ultimo: ultimo("en_rango") })).toBe("en_rango");
  });

  it("un nodo que dejó de enviar datos es «sin conexión», aunque su último estado fuera bueno", () => {
    expect(estadoVisual({ conexion: "sin_datos", ultimo: ultimo("en_rango") })).toBe(
      "sin_conexion",
    );
  });

  it("un nodo sin lecturas (o sin evaluar) no inventa un estado", () => {
    expect(estadoVisual({ conexion: "sin_lecturas", ultimo: null })).toBe("sin_lecturas");
    expect(estadoVisual({ conexion: "conectado", ultimo: ultimo(null) })).toBe("sin_lecturas");
  });
});

describe("ESTADOS_UI", () => {
  const todos = Object.keys(ESTADOS_UI) as EstadoVisual[];

  it("cada estado tiene palabra, símbolo y color: nunca solo color", () => {
    for (const e of todos) {
      const i = ESTADOS_UI[e];
      expect(i.palabra.length, e).toBeGreaterThan(2);
      expect(i.icono, e).toBeTruthy();
      expect(i.color, e).toMatch(/^var\(--/);
      expect(i.queHacer.length, e).toBeGreaterThan(20);
    }
    // Las palabras son distintas entre sí, para que dos estados no se confundan al leerlos.
    expect(new Set(todos.map((e) => ESTADOS_UI[e].palabra)).size).toBe(todos.length);
  });

  it("los estados de alerta no usan el mismo símbolo que «en rango»", () => {
    for (const e of ["atencion", "fuera_de_rango", "critico"] as const) {
      expect(ESTADOS_UI[e].icono).not.toBe(ESTADOS_UI.en_rango.icono);
    }
  });

  it("ningún texto dice «potable» ni «seguro» ni afirma una certificación", () => {
    for (const e of todos) {
      const t = `${ESTADOS_UI[e].palabra} ${ESTADOS_UI[e].queHacer}`;
      expect(t, e).not.toMatch(/potable|segur[oa]s?\b/i);
      expect(t, e).not.toMatch(/certific|cumple/i);
    }
  });
});
