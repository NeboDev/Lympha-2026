import type { AlarmaApi } from "@lympha/contracts";
import { describe, expect, it } from "vitest";
import {
  ETIQUETA_ESTADO,
  ETIQUETA_SEVERIDAD,
  ETIQUETA_TIPO,
  lineaDeEstado,
  titulo,
} from "./textos.ts";

const ID = "0192f3a7-0000-7000-8000-00000000e001";
const base: AlarmaApi = {
  id: ID,
  nodo_id: ID,
  nodo_nombre: "Cisterna",
  espacio_id: ID,
  tipo: "nivel",
  severidad: "critica",
  estado: "activa",
  causa: null,
  abierta_en: "2026-10-14T16:32:00.000Z",
  escalada_en: null,
  atendida_por: null,
  atendida_en: null,
  resuelta_en: null,
};

describe("textos de alertas", () => {
  it("el título de una alarma de calidad incluye la severidad; las demás se nombran por su tipo", () => {
    expect(titulo(base)).toBe("Calidad del agua: Crítica");
    expect(titulo({ tipo: "sin_conexion", severidad: "regular" })).toBe("Sin conexión");
    expect(titulo({ tipo: "sensor", severidad: "regular" })).toBe("Sensor por revisar");
  });

  it("la línea de estado dice quién atendió, por nombre y nunca por correo", () => {
    const l = lineaDeEstado({
      ...base,
      estado: "atendida",
      atendida_por: { id: ID, nombre: "Ana" },
      atendida_en: "2026-10-14T17:00:00.000Z",
    });
    expect(l).toMatch(/^Atendida por Ana el /);
    expect(l).not.toMatch(/@/);
  });

  it("una alarma atendida sin nombre no inventa quién fue ni muestra un identificador", () => {
    const l = lineaDeEstado({
      ...base,
      estado: "atendida",
      atendida_por: { id: ID, nombre: null },
      atendida_en: "2026-10-14T17:00:00.000Z",
    });
    expect(l).toMatch(/alguien del espacio/);
    expect(l).not.toContain(ID);
  });

  it("una resuelta dice cuándo; una activa, cuándo se abrió", () => {
    expect(
      lineaDeEstado({ ...base, estado: "resuelta", resuelta_en: "2026-10-14T18:00:00.000Z" }),
    ).toMatch(/^Resuelta el /);
    expect(lineaDeEstado(base)).toMatch(/^Abierta el /);
  });

  it("ningún texto dice «potable» ni «seguro» (RNF-32)", () => {
    const todos = [
      ...Object.values(ETIQUETA_TIPO),
      ...Object.values(ETIQUETA_SEVERIDAD),
      ...Object.values(ETIQUETA_ESTADO),
    ];
    for (const t of todos) expect(t).not.toMatch(/potable|seguro|segura/i);
  });
});
