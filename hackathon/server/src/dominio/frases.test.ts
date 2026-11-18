import { describe, expect, it } from "vitest";
import {
  AVISO_NO_CUBRE,
  avisoCambioRapido,
  avisoCritico,
  avisoFueraDeRango,
  avisoRecordatorio,
  avisoRecuperacion,
  avisoSensor,
  avisoSinConexion,
  type ContextoAviso,
  DIAGNOSTICO_CALIBRACION,
  detalleAlerta,
  duracionLegible,
  type FilaEstado,
  fechaMx,
  haceLegible,
  type Insignia,
  insigniaParametro,
  lineaCloro,
  periodoLegible,
  pieReporte,
  rangoNorma,
  resumenReporte,
  TEXTO_HUECOS_GRAFICA,
  TEXTO_NO_MEDIDOS,
  TEXTO_SIN_DATOS_GRAFICA,
  TEXTO_SIN_REGISTROS,
  TITULO_EVENTO,
  TITULO_REPORTE,
  type TipoRecordatorio,
  textoEstado,
  textosActuador,
  textosBot,
  tituloAlerta,
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
const T = Date.UTC(2026, 10, 19, 15, 0, 0);
const tipos: TipoRecordatorio[] = ["nivel", "cambio_rapido", "sensor", "sin_conexion"];

/** Los textos del reporte PDF, con insignias de todos los niveles y todos los tipos de alerta. */
function textosReporte(): string[] {
  const t: string[] = [TITULO_REPORTE, ...AVISO_NO_CUBRE, TEXTO_NO_MEDIDOS, TEXTO_SIN_REGISTROS];
  t.push(TEXTO_SIN_DATOS_GRAFICA, TEXTO_HUECOS_GRAFICA);
  const norma = { min: 6.5, max: 8.5, decimales: 2, origen: "de la NOM-127" };
  const insignias: Insignia[] = [];
  for (const pctEnRango of [null, 0, 50, 79.9, 80, 94.9, 95, 100]) {
    for (const coberturaPct of [0, 49, 50, 100]) {
      for (const n of [norma, { ...norma, min: null }, { ...norma, max: null }]) {
        insignias.push(
          insigniaParametro({
            nombre: "pH",
            articulo: "el",
            pctEnRango,
            coberturaPct,
            norma: n,
            coberturaMinPct: 50,
            bienPct: 95,
            atencionPct: 80,
          }),
        );
      }
    }
  }
  for (const i of insignias) t.push(i.texto, i.rotulo);
  for (const masGrave of [null, "atencion", "alta", "critica"] as const) {
    for (const total of [0, 1, 4]) {
      for (const huecos of [0, 1, 3]) {
        t.push(
          ...resumenReporte({
            comunidad: "Primaria X",
            nodo: "Tinaco",
            desde: new Date(T),
            hasta: new Date(T + 7 * 86_400_000),
            medidos: [{ nombre: "pH", articulo: "el" }],
            alertas: { total, masGrave },
            coberturaPct: 30,
            coberturaMinPct: 50,
            huecos,
            huecoMayorS: huecos ? 5400 : null,
          }),
        );
      }
    }
  }
  t.push(
    ...resumenReporte({
      comunidad: "P",
      nodo: "T",
      desde: new Date(T),
      hasta: new Date(T + 1000),
      medidos: [],
      alertas: { total: 0, masGrave: null },
      coberturaPct: 0,
      coberturaMinPct: 50,
      huecos: 1,
      huecoMayorS: null,
    }),
  );
  for (const tipo of ["nivel", "cambio_rapido", "sensor", "sin_conexion"] as const) {
    for (const severidadMaxima of ["atencion", "alta", "critica"] as const) {
      const a = { tipo, severidadMaxima, parametro: "pH" };
      t.push(tituloAlerta(a), tituloAlerta({ ...a, parametro: null }));
      for (const cerrada of [null, new Date(T + 18 * 60_000)]) {
        for (const valorApertura of [null, 6.2]) {
          t.push(
            detalleAlerta({
              ...a,
              abierta: new Date(T),
              cerrada,
              valorApertura,
              decimales: 2,
              hasta: new Date(T + 3600_000),
            }),
          );
        }
      }
    }
  }
  t.push(...Object.values(TITULO_EVENTO), ...Object.values(DIAGNOSTICO_CALIBRACION));
  t.push(pieReporte({ marca: "Lympha Atl", id: "abc", hash: "123", generado: new Date(T) }));
  return t;
}

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
  t.push(...textosReporte());
  for (const simulado of [true, false]) {
    const a = textosActuador({ nombre: "Bomba de cloro", simulado });
    t.push(a.enviada(10), a.terminada(10), a.detenidaPersona, a.cancelada, a.expirada, a.fallida);
    t.push(a.rechazada("El pH está fuera de rango: no se dosifica."));
    for (const m of ["fuera_de_rango", "sensor", "sin_datos"] as const) t.push(a.detenidaAuto(m));
  }
  const bot = textosBot(marca);
  t.push(
    bot.reporteEnCurso(1),
    bot.reporteEnCurso(7),
    bot.reporteLeyenda("Tinaco", 7),
    bot.reporteDiasInvalidos,
    bot.reporteOcupado,
    bot.reporteSinNodos,
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

describe("reporte", () => {
  const base = {
    nombre: "pH",
    articulo: "el" as const,
    coberturaPct: 100,
    norma: { min: 6.5, max: 8.5, decimales: 2, origen: "de la NOM-127" },
    coberturaMinPct: 50,
    bienPct: 95,
    atencionPct: 80,
  };

  it("la insignia dice «dentro del rango», con el porcentaje, y nunca «cumple»", () => {
    const i = insigniaParametro({ ...base, pctEnRango: 97.2 });
    expect(i.nivel).toBe("bien");
    expect(i.rotulo).toBe("En rango");
    expect(i.texto).toBe(
      "El pH estuvo dentro del rango de la NOM-127 (6.5 a 8.5) el 97.2 % del tiempo con datos.",
    );
  });

  it("los umbrales de la insignia salen de la configuración", () => {
    expect(insigniaParametro({ ...base, pctEnRango: 95 }).nivel).toBe("bien");
    expect(insigniaParametro({ ...base, pctEnRango: 94.9 }).nivel).toBe("atencion");
    expect(insigniaParametro({ ...base, pctEnRango: 80 }).nivel).toBe("atencion");
    const fuera = insigniaParametro({ ...base, pctEnRango: 79.9 });
    expect(fuera.nivel).toBe("fuera");
    expect(fuera.texto).toContain("solo el 79.9 %");
  });

  it("con poca cobertura o sin muestras no da un porcentaje", () => {
    for (const i of [
      insigniaParametro({ ...base, pctEnRango: 99, coberturaPct: 49 }),
      insigniaParametro({ ...base, pctEnRango: null, coberturaPct: 0 }),
    ]) {
      expect(i.nivel).toBe("sin_datos");
      expect(i.texto).toContain("no hay datos suficientes");
      expect(i.texto).not.toMatch(/\d+\.\d %/);
    }
  });

  it("concuerda el género", () => {
    const i = insigniaParametro({
      ...base,
      nombre: "turbidez",
      articulo: "la",
      pctEnRango: 99,
      norma: { min: null, max: 4, decimales: 1, origen: "de la NOM-127" },
    });
    expect(i.texto).toBe(
      "La turbidez estuvo dentro del rango de la NOM-127 (hasta 4) el 99.0 % del tiempo con datos.",
    );
  });

  it("rangoNorma", () => {
    expect(rangoNorma(6.5, 8.5, 2)).toBe("6.5 a 8.5");
    expect(rangoNorma(null, 4, 1)).toBe("hasta 4");
    expect(rangoNorma(0.2, null, 2)).toBe("0.2 o más");
    expect(rangoNorma(null, null, 2)).toBeNull();
  });

  it("las fechas van en hora de México", () => {
    // 2026-11-19 15:00 UTC = 09:00 en la Ciudad de México (UTC−6, sin horario de verano).
    expect(fechaMx(new Date(Date.UTC(2026, 10, 19, 15, 0)))).toBe("19 nov 2026, 09:00");
    expect(fechaMx(new Date(Date.UTC(2026, 10, 19, 15, 0)), false)).toBe("19 nov 2026");
    // Cerca de la medianoche cambia el día respecto de UTC.
    expect(fechaMx(new Date(Date.UTC(2026, 0, 1, 3, 30)))).toBe("31 dic 2025, 21:30");
    expect(
      periodoLegible(new Date(Date.UTC(2026, 10, 12, 15)), new Date(Date.UTC(2026, 10, 19, 15))),
    ).toBe("12 nov 2026, 09:00 a 19 nov 2026, 09:00 (hora de México)");
  });

  it("el resumen cuenta alertas y huecos", () => {
    const l = resumenReporte({
      comunidad: "Primaria X",
      nodo: "Tinaco",
      desde: new Date(Date.UTC(2026, 10, 12, 15)),
      hasta: new Date(Date.UTC(2026, 10, 19, 15)),
      medidos: [{ nombre: "pH", articulo: "el" }],
      alertas: { total: 2, masGrave: "critica" },
      coberturaPct: 94.4,
      coberturaMinPct: 50,
      huecos: 3,
      huecoMayorS: 5400,
    });
    expect(l[0]).toBe(
      "Del 12 nov 2026 al 19 nov 2026, el nodo «Tinaco» de «Primaria X» midió: pH.",
    );
    expect(l).toContain("Hubo 2 alertas (la más grave fue de severidad crítica).");
    expect(l).toContain(
      "Se recibieron datos durante el 94 % del periodo, con 3 huecos sin datos, el más largo de 1 hora 30 minutos.",
    );
  });

  it("sin alertas lo dice, y no inventa gravedad", () => {
    const l = resumenReporte({
      comunidad: "P",
      nodo: "T",
      desde: new Date(0),
      hasta: new Date(86_400_000),
      medidos: [],
      alertas: { total: 0, masGrave: null },
      coberturaPct: 100,
      coberturaMinPct: 50,
      huecos: 0,
      huecoMayorS: null,
    });
    expect(l).toContain("No hubo alertas en este periodo.");
    expect(l.join(" ")).toContain("todavía no hay parámetros configurados");
  });

  it("los títulos de alerta nombran el parámetro", () => {
    expect(tituloAlerta({ tipo: "nivel", severidadMaxima: "critica", parametro: "pH" })).toBe(
      "pH crítico",
    );
    expect(
      tituloAlerta({ tipo: "cambio_rapido", severidadMaxima: "atencion", parametro: "pH" }),
    ).toBe("Cambio rápido de pH");
    expect(tituloAlerta({ tipo: "sin_conexion", severidadMaxima: "alta", parametro: null })).toBe(
      "Nodo sin conexión",
    );
  });

  it("solo usa caracteres que las fuentes estándar del PDF dibujan", () => {
    // WinAnsi (Windows-1252): letras latinas con acento y la puntuación usual; nada de emoji ni ≥.
    const permitido = /^[\x20-\x7E -ÿ–—‘’“”…€\n]*$/;
    for (const texto of textosReporte()) expect(texto, texto).toMatch(permitido);
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
