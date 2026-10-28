import { crearLoteBody, etiquetaEntregadaApi, listaNodosAdminQuery } from "@lympha/contracts";
import { describe, expect, it } from "vitest";
import { identidadNueva, nombreAp } from "../fabrica/index.ts";
import { entregarEtiqueta } from "./etiquetas.ts";

const ID = "0192f3a7-0000-7000-8000-0000000d00a1";
const LOTE = "0192f3a7-0000-7000-8000-0000000000f1";

describe("entregarEtiqueta", () => {
  it("arma una etiqueta de 80 × 44 mm con el código, la red y la clave de ese nodo", () => {
    const nodo = identidadNueva(ID);
    const e = entregarEtiqueta(nodo, LOTE, "v1");
    expect(() => etiquetaEntregadaApi.parse(e)).not.toThrow();
    expect(e.red_ap).toBe(nombreAp(ID));
    expect(e.svg).toContain('width="80mm" height="44mm"');
    expect(e.svg).toContain(nodo.codigoReclamo);
    expect(e.svg).toContain(nodo.apKey);
    expect(e.svg).not.toMatch(/potable|seguro/i); // RNF-32
  });

  it("cada identidad nueva es distinta y el código sale con guiones de 4 en 4", () => {
    const a = identidadNueva(ID);
    const b = identidadNueva(ID);
    expect(a.codigoReclamo).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(a.codigoReclamo).not.toBe(b.codigoReclamo);
    expect(a.mqttPassword).not.toBe(b.mqttPassword);
    expect(a.apKey).not.toBe(b.apKey);
  });
});

describe("contratos del panel", () => {
  it("el cuerpo de crear lote rechaza lo desconocido y cantidades fuera de 1–50", () => {
    expect(crearLoteBody.parse({ cantidad: 5 })).toEqual({ cantidad: 5, version_hw: "v1" });
    for (const malo of [
      { cantidad: 0 },
      { cantidad: 51 },
      { cantidad: 1.5 },
      { cantidad: 1, x: 1 },
    ]) {
      expect(crearLoteBody.safeParse(malo).success).toBe(false);
    }
  });

  it("el selector de nodos pone límites por omisión y rechaza estados y parámetros desconocidos", () => {
    expect(listaNodosAdminQuery.parse({})).toEqual({ limite: 50, desplazamiento: 0 });
    expect(listaNodosAdminQuery.parse({ estado: "fabricado", limite: "10" })).toMatchObject({
      estado: "fabricado",
      limite: 10,
    });
    for (const malo of [{ estado: "raro" }, { limite: 101 }, { otra: 1 }, { lote: "no-uuid" }]) {
      expect(listaNodosAdminQuery.safeParse(malo).success).toBe(false);
    }
  });
});
