import { describe, expect, it } from "vitest";
import {
  avisoCambioRapido,
  avisoCritico,
  avisoFueraDeRango,
  avisoRecordatorio,
  avisoRecuperacion,
  avisoSensor,
  avisoSinConexion,
  type ContextoAviso,
  duracionLegible,
  type FilaEstado,
  haceLegible,
  lineaCloro,
  type TipoRecordatorio,
  textoEstado,
  textosBot,
} from "./frases.ts";
import type { Marca } from "./marca.ts";

const marca: Marca = {
  nombre: "Atl",
  nombre_bot: "Lympha-HP26",
  alarma_local_en_avisos: false,
  dosificacion_automatica: false,
};

const ph: ContextoAviso = {
  nodo: "Tinaco azotea",
  parametro: "pH",
  articulo: "el",
  valor: 6.2,
  decimales: 2,
  unidad: "",
  min: 6.5,
  max: 8.5,
};
const turbidez: ContextoAviso = {
  nodo: "Cisterna",
  parametro: "turbidez",
  articulo: "la",
  valor: 7.3,
  decimales: 1,
  unidad: "UTN",
  min: null,
  max: 4,
};
const contextos: ContextoAviso[] = [
  ph,
  { ...ph, valor: 9.7 },
  { ...ph, valor: null },
  turbidez,
  { ...turbidez, min: 1, max: null },
  { ...turbidez, min: null, max: null },
];
const tipos: TipoRecordatorio[] = ["nivel", "cambio_rapido", "sensor", "sin_conexion"];

/** Todos los textos que la comunidad puede recibir, con muchas combinaciones de datos. */
function todosLosTextos(): string[] {
  const t: string[] = [];
  const cloros = [null, lineaCloro(8.3, 25, 40), lineaCloro(9.4, 15, 40)];
  for (const c of contextos) {
    for (const cloro of cloros) {
      t.push(avisoFueraDeRango(c, cloro));
      t.push(avisoCritico(c, { cloro }));
      t.push(avisoCritico(c, { cloro, dosificacionDetenida: true }));
    }
    for (const cambio of [null, 0.6, -0.9]) t.push(avisoCambioRapido(c, { cambio, ventanaMin: 5 }));
    t.push(avisoSensor(c));
    for (const tipo of tipos) {
      for (const duracionMin of [0, 1, 18, 65, 120, 3000]) {
        t.push(avisoRecordatorio(c, { tipo, duracionMin }));
        t.push(avisoRecuperacion(c, { tipo, duracionMin }));
      }
    }
  }
  for (const silencioMin of [0, 1, 5, 90]) {
    t.push(avisoSinConexion({ nodo: "Tinaco", silencioMin }));
    t.push(avisoSinConexion({ nodo: "Tinaco", silencioMin, alarmaLocal: true }));
  }
  const filas: FilaEstado[] = [
    { nodo: "A", estado: "en_rango", lectura: "pH 7.20", haceS: 4 },
    { nodo: "B", estado: "atencion", lectura: "pH 6.70", haceS: 90 },
    { nodo: "C", estado: "fuera_de_rango", lectura: "pH 6.20", haceS: 7200 },
    { nodo: "D", estado: "critico", lectura: null, haceS: null },
    { nodo: "E", estado: "revisar_sensor", lectura: null, haceS: 30 },
    { nodo: "F", estado: "sin_conexion", lectura: "pH 7.0", haceS: 600 },
    { nodo: "G", estado: null, lectura: null, haceS: null },
  ];
  t.push(textoEstado("Primaria", filas, marca), textoEstado("Primaria", [], marca));
  const bot = textosBot(marca);
  t.push(
    bot.ayuda,
    bot.vinculado("Primaria X"),
    bot.vencido,
    bot.ocupado,
    bot.comunidadInexistente,
    bot.noVinculado,
    bot.desvinculado,
    bot.nadaQueDesvincular,
    bot.soloQuienVinculo,
    bot.errorInterno,
  );
  return t;
}

describe("honestidad de los textos (RNF-32)", () => {
  it("ningún texto dice «potable» ni «seguro»", () => {
    const textos = todosLosTextos();
    expect(textos.length).toBeGreaterThan(300);
    for (const texto of textos) {
      expect(texto, texto).not.toMatch(/potable|segur[oa]s?\b/i);
    }
  });

  it("ningún texto afirma una certificación", () => {
    for (const texto of todosLosTextos()) {
      expect(texto, texto).not.toMatch(/(?<!no )certific(a|amos) (el )?agua|cumple (la )?nom/i);
    }
  });

  it("sin dosificación automática ni alarma local confirmadas, los avisos no las prometen", () => {
    expect(avisoCritico(ph)).not.toMatch(/dosificaci/i);
    expect(avisoSinConexion({ nodo: "T", silencioMin: 5 })).not.toMatch(/alarma local/i);
    expect(avisoCritico(ph, { dosificacionDetenida: true })).toMatch(/Detuvimos la dosificación/);
    expect(avisoSinConexion({ nodo: "T", silencioMin: 5, alarmaLocal: true })).toMatch(
      /alarma local/,
    );
  });
});

describe("avisos", () => {
  it("fuera de rango dice qué pasó, el valor, lo normal y qué hacer", () => {
    const t = avisoFueraDeRango(ph);
    expect(t).toContain("«Tinaco azotea»");
    expect(t).toContain("El pH está en 6.20 (lo normal va de 6.5 a 8.5)");
    expect(t).toMatch(/Qué hacer/);
  });

  it("concuerda el género y las unidades del parámetro", () => {
    expect(avisoFueraDeRango(turbidez)).toContain(
      "La turbidez está en 7.3 UTN (lo normal es hasta 4)",
    );
    expect(
      avisoRecuperacion({ ...turbidez, valor: 2 }, { tipo: "nivel", duracionMin: 30 }),
    ).toContain("La turbidez de «Cisterna» volvió al rango (2.0 UTN)");
  });

  it("cambio rápido muestra la magnitud sin signo", () => {
    expect(avisoCambioRapido(ph, { cambio: -0.9, ventanaMin: 5 })).toContain(
      "cambió 0.90 en 5 minutos",
    );
  });

  it("sin conexión y recuperación usan duraciones legibles", () => {
    expect(avisoSinConexion({ nodo: "T", silencioMin: 5 })).toContain("desde hace 5 minutos");
    expect(avisoRecuperacion(ph, { tipo: "nivel", duracionMin: 65 })).toContain(
      "La alerta duró 1 hora 5 minutos",
    );
    expect(avisoRecuperacion(ph, { tipo: "sin_conexion", duracionMin: 1 })).toContain(
      "volvió a enviar datos",
    );
  });

  it("los textos con valor nulo no inventan cifras", () => {
    const t = avisoFueraDeRango({ ...ph, valor: null });
    expect(t).toContain("está en —");
    expect(t).not.toMatch(/NaN|undefined|null/);
  });
});

describe("duraciones", () => {
  it("duracionLegible", () => {
    expect(duracionLegible(0)).toBe("menos de 1 minuto");
    expect(duracionLegible(1)).toBe("1 minuto");
    expect(duracionLegible(18)).toBe("18 minutos");
    expect(duracionLegible(60)).toBe("1 hora");
    expect(duracionLegible(65)).toBe("1 hora 5 minutos");
    expect(duracionLegible(121)).toBe("2 horas 1 minuto");
    expect(duracionLegible(-5)).toBe("menos de 1 minuto");
  });

  it("haceLegible", () => {
    expect(haceLegible(4)).toBe("hace 4 s");
    expect(haceLegible(90)).toBe("hace 2 minutos");
    expect(haceLegible(60)).toBe("hace 1 minuto");
    expect(haceLegible(7200)).toBe("hace 2 horas");
  });
});

describe("línea del cloro", () => {
  it("avisa cuando el cloro actúa con menos fuerza y calcula el porcentaje", () => {
    const l = lineaCloro(8.3, 25, 40);
    expect(l).toContain("Con este pH (8.3)");
    expect(l).toContain("~15 %");
    expect(l).toContain("corregir el pH antes de subir la dosis");
  });

  it("no dice nada si el cloro sigue actuando bien", () => {
    expect(lineaCloro(7.0, 25, 40)).toBeNull();
    expect(lineaCloro(7.5, 25, 40)).toBeNull(); // ≈ 52 %
  });

  it("depende de la temperatura", () => {
    // pH 7.8: ≈ 36 % a 25 °C (avisa) y ≈ 41 % a 15 °C (no avisa) con umbral 40 %.
    expect(lineaCloro(7.8, 25, 40)).not.toBeNull();
    expect(lineaCloro(7.8, 15, 40)).toBeNull();
  });

  it("se añade al aviso y no cambia el resto", () => {
    const l = lineaCloro(8.9, 25, 40);
    expect(avisoFueraDeRango({ ...ph, valor: 8.9 }, l)).toContain("ℹ️");
    expect(avisoFueraDeRango({ ...ph, valor: 8.9 }, null)).not.toContain("ℹ️");
  });
});

describe("/estado", () => {
  it("muestra palabra y emoji de estado, la lectura y su antigüedad", () => {
    const t = textoEstado(
      "Primaria",
      [{ nodo: "Tinaco", estado: "fuera_de_rango", lectura: "pH 6.20", haceS: 4 }],
      marca,
    );
    expect(t).toContain("🟠 Fuera de rango");
    expect(t).toContain("pH 6.20");
    expect(t).toContain("lectura hace 4 s");
    expect(t).toContain("Atl ayuda a vigilar el agua; no la certifica.");
  });

  it("sin nodos o sin lecturas lo dice con claridad", () => {
    expect(textoEstado("P", [], marca)).toMatch(/aún no tiene nodos/);
    expect(
      textoEstado("P", [{ nodo: "T", estado: null, lectura: null, haceS: null }], marca),
    ).toContain("todavía no hay lecturas");
  });
});

describe("bot", () => {
  it("usa el nombre de la marca", () => {
    const b = textosBot({ ...marca, nombre: "Aguita", nombre_bot: "Otro-Bot" });
    expect(b.ayuda).toContain("Soy Otro-Bot");
    expect(b.ayuda).toContain("Aguita no certifica el agua");
    expect(b.vencido).toContain("Aguita");
  });
});
