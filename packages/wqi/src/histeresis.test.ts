import { describe, expect, it } from "vitest";
import {
  avanzarCanal,
  type Canal,
  canalNuevo,
  NIVELES,
  type Nivel,
  nivelCandidato,
  perfilCisterna,
} from "./index.ts";

const N = { empeorar: 3, mejorar: 5 };
const correr = (inicial: Canal<Nivel>, candidatos: Nivel[]): Nivel[] => {
  let c = inicial;
  return candidatos.map((x) => {
    c = avanzarCanal(c, x, NIVELES, N);
    return c.actual as Nivel;
  });
};

describe("avanzarCanal", () => {
  it("el primer candidato se adopta de inmediato", () => {
    expect(avanzarCanal(canalNuevo<Nivel>(), "regular", NIVELES, N).actual).toBe("regular");
  });

  it("una lectura aislada no cambia el nivel (RF-21)", () => {
    const r = correr(canalNuevo("buena"), ["buena", "critica", "buena", "buena"]);
    expect(r).toEqual(["buena", "buena", "buena", "buena"]);
  });

  it("empeorar se confirma tras 3 lecturas seguidas", () => {
    expect(correr(canalNuevo("buena"), ["mala", "mala", "mala", "mala"])).toEqual([
      "buena",
      "buena",
      "mala",
      "mala",
    ]);
  });

  it("mejorar necesita 5 lecturas seguidas", () => {
    const r = correr(canalNuevo("mala"), ["buena", "buena", "buena", "buena", "buena"]);
    expect(r).toEqual(["mala", "mala", "mala", "mala", "buena"]);
  });

  it("una interrupción reinicia la cuenta", () => {
    const r = correr(canalNuevo("mala"), [
      "buena",
      "buena",
      "buena",
      "buena",
      "mala",
      "buena",
      "buena",
      "buena",
      "buena",
      "buena",
    ]);
    expect(r.slice(0, 9)).toEqual(Array(9).fill("mala"));
    expect(r[9]).toBe("buena");
  });

  it("una tendencia irregular hacia lo peor no reinicia la cuenta y confirma el nivel menos extremo", () => {
    expect(correr(canalNuevo("buena"), ["critica", "mala", "critica"])).toEqual([
      "buena",
      "buena",
      "mala",
    ]);
  });

  it("cambiar de sentido reinicia la cuenta", () => {
    const r = correr(canalNuevo("regular"), ["mala", "mala", "buena", "mala", "mala", "mala"]);
    expect(r).toEqual(["regular", "regular", "regular", "regular", "regular", "mala"]);
  });
});

describe("nivelCandidato (margen al mejorar)", () => {
  const p = perfilCisterna;
  it("al empeorar no hay margen: cruzar el umbral basta", () => {
    expect(nivelCandidato(p, 79.9, "buena")).toBe("regular");
  });
  it("al mejorar hay que pasar el umbral más el margen", () => {
    expect(nivelCandidato(p, 80.5, "regular")).toBe("regular");
    expect(nivelCandidato(p, 82.9, "regular")).toBe("regular");
    expect(nivelCandidato(p, 83, "regular")).toBe("buena");
  });
  it("puede subir varios niveles si el puntaje los supera con margen", () => {
    expect(nivelCandidato(p, 95, "critica")).toBe("buena");
    expect(nivelCandidato(p, 62, "critica")).toBe("mala");
  });
  it("sin puntaje válido el candidato es sin_datos", () => {
    expect(nivelCandidato(p, null, "buena")).toBe("sin_datos");
  });
  it("un puntaje que ronda el umbral no oscila", () => {
    let actual: Nivel = "buena";
    const vistos: Nivel[] = [];
    for (const puntaje of [79, 81, 79, 82, 78, 82.5, 79]) {
      const c = nivelCandidato(p, puntaje, actual);
      vistos.push(c);
      actual = c;
    }
    expect(vistos).toEqual(Array(7).fill("regular"));
  });
});
