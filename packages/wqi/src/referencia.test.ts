import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type Evaluacion,
  evaluar,
  type Mediciones,
  perfilCisterna,
  validarPerfil,
} from "./index.ts";

interface Caso {
  nombre: string;
  mediciones: Mediciones;
  esperado: Pick<Evaluacion, "wqi" | "puntajeDecision" | "nivel" | "subindices" | "limitante">;
}
const archivo = JSON.parse(
  readFileSync(new URL("../fixtures/cisterna.json", import.meta.url), "utf8"),
) as { version: string; casos: Caso[] };

describe("casos de referencia del perfil cisterna (RNF-24)", () => {
  it("los casos son de la versión vigente del algoritmo", () => {
    expect(
      archivo.version,
      "Subiste la versión del perfil: regenera los casos con `pnpm --filter @lympha/wqi fixtures` y revisa el diff",
    ).toBe(perfilCisterna.version);
  });

  for (const caso of archivo.casos) {
    it(caso.nombre, () => {
      const e = evaluar(perfilCisterna, caso.mediciones);
      expect(
        {
          wqi: e.wqi,
          puntajeDecision: e.puntajeDecision,
          nivel: e.nivel,
          subindices: e.subindices,
          limitante: e.limitante,
        },
        "Un resultado cambió: si la curva cambió a propósito, sube `version` en perfiles/cisterna.ts y regenera los casos (RNF-24)",
      ).toEqual(caso.esperado);
    });
  }

  it("es determinista: mismas mediciones, mismo resultado", () => {
    for (const caso of archivo.casos) {
      expect(evaluar(perfilCisterna, caso.mediciones)).toEqual(
        evaluar(perfilCisterna, caso.mediciones),
      );
    }
  });

  it("la versión provisional se declara como tal", () => {
    expect(perfilCisterna.version).toMatch(/provisional/);
    expect(perfilCisterna.estado).toBe("provisional");
  });
});

describe("configuración del perfil", () => {
  it("es coherente (curvas crecientes, pesos que suman 1, umbrales decrecientes)", () => {
    expect(validarPerfil(perfilCisterna)).toEqual([]);
  });

  it("los límites de la NOM-127 quedan exactamente en el borde de 'buena'", () => {
    const u = perfilCisterna.umbrales.buena;
    const base: Mediciones = {
      ph: 7.2,
      temperatura: 22,
      conductividad: 450,
      turbidez: 0.6,
      tds: 290,
    };
    for (const [parametro, valor] of [
      ["ph", 6.5],
      ["ph", 8.5],
      ["turbidez", 4],
      ["tds", 1000],
      ["conductividad", 1500],
    ] as const) {
      const e = evaluar(perfilCisterna, { ...base, [parametro]: valor });
      expect(e.subindices[parametro], `${parametro}=${valor}`).toBe(u);
      expect(e.nivel).toBe("buena");
    }
    // un pelo pasado el límite ya no es buena
    expect(evaluar(perfilCisterna, { ...base, turbidez: 4.2 }).nivel).toBe("regular");
    expect(evaluar(perfilCisterna, { ...base, ph: 8.6 }).nivel).toBe("regular");
  });

  it("validarPerfil detecta una configuración rota", () => {
    const rota = structuredClone(perfilCisterna) as unknown as {
      parametros: { ph: { curva: number[][]; peso: number } };
    };
    rota.parametros.ph.curva = [
      [7, 100],
      [6, 50],
    ];
    rota.parametros.ph.peso = 0.5;
    const problemas = validarPerfil(rota as never);
    expect(problemas.some((p) => p.includes("deben crecer"))).toBe(true);
    expect(problemas.some((p) => p.includes("suman"))).toBe(true);
  });
});
