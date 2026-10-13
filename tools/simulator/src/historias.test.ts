import { evaluarSerie, type Lectura, perfilCisterna, transiciones } from "@lympha/wqi";
import { describe, expect, it } from "vitest";
import { HISTORIAS, medicionesDeHistoria } from "./historias.ts";

const MINUTO = 60_000;
const T0 = Date.UTC(2026, 0, 1);

/** Lo que el worker haría con la historia del escenario, sin broker ni base. */
function correr(nombre: string, semilla?: number) {
  const e = HISTORIAS.find((x) => x.nombre === nombre);
  if (!e) throw new Error(`historia desconocida ${nombre}`);
  const lecturas: Lectura[] = medicionesDeHistoria(e, semilla).map((m, i) => ({
    ts: T0 + i * MINUTO,
    ...m,
  }));
  return { escenario: e, ...evaluarSerie(perfilCisterna, lecturas) };
}

describe("historias del simulador: nivel esperado sin parpadeo (criterio de salida de H2)", () => {
  for (const e of HISTORIAS) {
    it(`${e.nombre}: ${e.esperado.transiciones.join(" → ")}`, () => {
      const { resultados } = correr(e.nombre);
      // sin las lecturas de arranque, donde el nivel aún es "sin_datos" por falta de ventana
      const vistos = transiciones(resultados.slice(perfilCisterna.ventana.minimoLecturas - 1));
      expect(vistos).toEqual(e.esperado.transiciones);

      const ultimo = resultados.at(-1);
      expect(ultimo?.nivel).toBe(e.esperado.transiciones.at(-1));
      expect(ultimo?.confianza).toBe(e.esperado.confianzaFinal);
      if (e.esperado.parametroFinal !== undefined) {
        expect(ultimo?.parametroLimitante).toBe(e.esperado.parametroFinal);
      }
    });
  }

  it("el resultado no depende de la semilla del ruido", () => {
    for (const e of HISTORIAS) {
      for (const semilla of [1, 2, 3, 99, 12345]) {
        const { resultados } = correr(e.nombre, semilla);
        const vistos = transiciones(resultados.slice(perfilCisterna.ventana.minimoLecturas - 1));
        expect(vistos, `${e.nombre} con semilla ${semilla}`).toEqual(e.esperado.transiciones);
      }
    }
  });

  it("nunca se dice 'buena' mientras un sensor está en revisión", () => {
    for (const nombre of ["sensor_congelado", "sensor_fuera_de_rango"]) {
      const { resultados } = correr(nombre);
      for (const r of resultados) {
        if (r.confianza === "revisar") expect(r.nivel).not.toBe("buena");
      }
    }
  });

  it("los nombres son únicos y cada escenario tiene una descripción", () => {
    expect(new Set(HISTORIAS.map((e) => e.nombre)).size).toBe(HISTORIAS.length);
    for (const e of HISTORIAS) expect(e.descripcion.length).toBeGreaterThan(10);
  });
});
