import { EVENTOS_AVISO, SEVERIDADES_ALARMA, TIPOS_ALARMA } from "@lympha/contracts";
import { frasePara, todasLasFrases } from "@lympha/wqi";
import { describe, expect, it } from "vitest";
import { duracion, nombreNodo, textoAviso } from "./plantillas.ts";

const PROHIBIDAS = /potable|\bseguro\b|\bsegura\b|\bapta\b|\bapto\b/i;

describe("textos de aviso", () => {
  it("ninguna combinación de evento, tipo y severidad dice 'potable' ni 'seguro' (RNF-32)", () => {
    const frases = todasLasFrases();
    for (const evento of EVENTOS_AVISO) {
      for (const tipo of TIPOS_ALARMA) {
        for (const severidad of SEVERIDADES_ALARMA) {
          for (const anterior of SEVERIDADES_ALARMA) {
            for (const f of frases) {
              const t = textoAviso({
                evento,
                tipo,
                nodo: "Cisterna",
                espacio: "Casa",
                severidad,
                anterior,
                causa: f,
                accion: f,
                minutos: 95,
              });
              expect(t, `${evento}/${tipo}/${severidad}`).not.toMatch(PROHIBIDAS);
              expect(t.length).toBeGreaterThan(10);
            }
          }
        }
      }
    }
  });

  it("incluye nodo, espacio, causa y acción de H2 en un aviso de nivel", () => {
    const f = frasePara({
      nivel: "critica",
      confianza: "ok",
      limitante: { parametro: "turbidez", direccion: "alto" },
      invalidos: [],
    });
    const t = textoAviso({
      evento: "abierta",
      tipo: "nivel",
      nodo: "Cisterna",
      espacio: "Casa",
      severidad: "critica",
      causa: f.causa,
      accion: f.accion,
    });
    expect(t).toContain("Cisterna · Casa");
    expect(t).toContain("crítica");
    expect(t).toContain(f.causa);
    expect(t).toContain(f.accion);
  });

  it("escalada y mejorada nombran el nivel anterior", () => {
    const escalada = textoAviso({
      evento: "escalada",
      tipo: "nivel",
      nodo: "N",
      espacio: "E",
      severidad: "critica",
      anterior: "mala",
    });
    expect(escalada).toMatch(/crítica \(antes mala\)/);
    const mejorada = textoAviso({
      evento: "mejorada",
      tipo: "nivel",
      nodo: "N",
      espacio: "E",
      severidad: "regular",
      anterior: "critica",
    });
    expect(mejorada).toMatch(/regular \(antes crítica\)/);
  });

  it("sin conexión y recordatorio llevan la duración", () => {
    const sc = textoAviso({
      evento: "sin_conexion",
      tipo: "sin_conexion",
      nodo: "N",
      espacio: "E",
      minutos: 12,
    });
    expect(sc).toContain("12 min");
    const rec = textoAviso({
      evento: "recordatorio",
      tipo: "nivel",
      nodo: "N",
      espacio: "E",
      severidad: "mala",
      minutos: 400,
    });
    expect(rec).toContain("6 h 40 min");
  });
});

describe("formato", () => {
  it("duración legible", () => {
    expect(duracion(0)).toBe("1 min");
    expect(duracion(59)).toBe("59 min");
    expect(duracion(60)).toBe("1 h");
    expect(duracion(125)).toBe("2 h 5 min");
    expect(duracion(3000)).toBe("2 días");
  });

  it("nombre del nodo: el que puso el usuario o uno genérico", () => {
    expect(nombreNodo("  Tinaco  ", "0190a3b4-1111-7222-8333-444455556666")).toBe("Tinaco");
    expect(nombreNodo(null, "0190a3b4-1111-7222-8333-444455556666")).toBe("Nodo 6666");
    expect(nombreNodo("", "0190a3b4-1111-7222-8333-444455556666")).toBe("Nodo 6666");
  });
});
