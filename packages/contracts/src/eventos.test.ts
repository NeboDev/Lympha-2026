import { describe, expect, it } from "vitest";
import { eventoSnapshot, nombreEventoEspacio } from "./eventos.ts";

const NODO = "0192f3a7-0000-7000-8000-00000000e001";
const ESPACIO = "0192f3a7-0000-7000-8000-00000000a0e1";

describe("nombreEventoEspacio", () => {
  it("distingue estado de calidad, alarma y conexión por sus claves", () => {
    expect(nombreEventoEspacio(JSON.stringify({ nodo_id: NODO, nivel: "buena" }))).toBe("estado");
    expect(
      nombreEventoEspacio(JSON.stringify({ alarma_id: NODO, nodo_id: NODO, cambio: "abierta" })),
    ).toBe("alarma");
    expect(
      nombreEventoEspacio(JSON.stringify({ nodo_id: NODO, espacio_id: ESPACIO, conectado: false })),
    ).toBe("conexion");
  });

  it("reconoce el cambio de calibración por calibracion_id", () => {
    expect(
      nombreEventoEspacio(
        JSON.stringify({ calibracion_id: NODO, nodo_id: NODO, cambio: "registrada" }),
      ),
    ).toBe("calibracion");
  });

  it("una alarma gana si el mensaje trae ambas claves", () => {
    expect(nombreEventoEspacio(JSON.stringify({ alarma_id: NODO, conectado: true }))).toBe(
      "alarma",
    );
  });

  it("lo que no se puede leer se trata como estado (como antes)", () => {
    expect(nombreEventoEspacio("no es json")).toBe("estado");
    expect(nombreEventoEspacio("42")).toBe("estado");
    expect(nombreEventoEspacio("null")).toBe("estado");
  });
});

describe("eventoSnapshot", () => {
  it("un snapshot anterior, sin conexiones, sigue siendo válido", () => {
    expect(eventoSnapshot.parse({ nodos: [] })).toEqual({ nodos: [], conexiones: [] });
  });
});
