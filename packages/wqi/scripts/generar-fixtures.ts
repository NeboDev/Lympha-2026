// Regenera packages/wqi/fixtures/cisterna.json a partir de las ENTRADAS de este archivo y del perfil actual.
//
//   pnpm --filter @lympha/wqi fixtures
//
// Se corre al subir la versión de las curvas (RNF-24). Revisa el diff del JSON a mano: cada cambio de
// resultado es un cambio de comportamiento visible para los usuarios.
import { writeFileSync } from "node:fs";
import { evaluar, type Mediciones, perfilCisterna } from "../src/index.ts";

const base: Mediciones = { ph: 7.2, temperatura: 22, conductividad: 450, turbidez: 0.6, tds: 290 };
const con = (cambios: Partial<Mediciones>): Mediciones => ({ ...base, ...cambios });

export const ENTRADAS: { nombre: string; mediciones: Mediciones }[] = [
  { nombre: "agua ideal", mediciones: base },
  { nombre: "pH justo en el límite inferior de la NOM-127 (6.5)", mediciones: con({ ph: 6.5 }) },
  { nombre: "pH justo en el límite superior de la NOM-127 (8.5)", mediciones: con({ ph: 8.5 }) },
  { nombre: "turbidez justo en el límite (4 NTU)", mediciones: con({ turbidez: 4 }) },
  { nombre: "TDS justo en el límite (1000 mg/L)", mediciones: con({ tds: 1000 }) },
  { nombre: "pH ácido (5.8) con todo lo demás ideal", mediciones: con({ ph: 5.8 }) },
  { nombre: "pH alcalino (9.3) con todo lo demás ideal", mediciones: con({ ph: 9.3 }) },
  {
    nombre: "turbidez de 12 NTU con todo lo demás ideal: un parámetro crítico limita el nivel",
    mediciones: con({ turbidez: 12 }),
  },
  {
    nombre: "turbidez de 6 NTU: regular aunque el promedio sea alto",
    mediciones: con({ turbidez: 6 }),
  },
  { nombre: "turbidez de 8 NTU: mala", mediciones: con({ turbidez: 8 }) },
  {
    nombre: "sales altas (TDS 1400, CE 2150)",
    mediciones: con({ tds: 1400, conductividad: 2150 }),
  },
  { nombre: "agua caliente (40 °C) no limita por sí sola", mediciones: con({ temperatura: 40 }) },
  {
    nombre: "todo en mal estado",
    mediciones: { ph: 5.0, temperatura: 50, conductividad: 4500, turbidez: 30, tds: 3000 },
  },
  {
    nombre: "sin turbidez (sensor sin dato): se recalcula con el peso restante",
    mediciones: con({ turbidez: null }),
  },
  {
    nombre: "solo temperatura: no alcanza el peso mínimo",
    mediciones: { ph: null, temperatura: 22, conductividad: null, turbidez: null, tds: null },
  },
  {
    nombre: "sin ninguna medición",
    mediciones: { ph: null, temperatura: null, conductividad: null, turbidez: null, tds: null },
  },
];

if (import.meta.main) {
  const casos = ENTRADAS.map(({ nombre, mediciones }) => {
    const e = evaluar(perfilCisterna, mediciones);
    return {
      nombre,
      mediciones,
      esperado: {
        wqi: e.wqi,
        puntajeDecision: e.puntajeDecision,
        nivel: e.nivel,
        subindices: e.subindices,
        limitante: e.limitante,
      },
    };
  });
  const url = new URL("../fixtures/cisterna.json", import.meta.url);
  writeFileSync(
    url,
    `${JSON.stringify({ perfil: "cisterna", version: perfilCisterna.version, casos }, null, 2)}\n`,
  );
  console.log(`${casos.length} casos escritos para la versión ${perfilCisterna.version}`);
}
