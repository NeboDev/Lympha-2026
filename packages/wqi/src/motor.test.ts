import { describe, expect, it } from "vitest";
import {
  evaluarSerie,
  type Lectura,
  type Mediciones,
  perfilCisterna as perfil,
  transiciones,
} from "./index.ts";

const MINUTO = 60_000;
const T0 = Date.UTC(2026, 0, 1);

/** Ruido determinista (xorshift) para que las pruebas no dependan del azar. */
function azar(semilla: number) {
  let s = semilla >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff - 0.5;
  };
}

/**
 * Serie de lecturas con ruido de sensor real. `centros(i)` fija el valor alrededor del que oscila cada
 * parámetro; `fijos(i)` fuerza valores exactos (para simular un sensor congelado).
 */
function serie(
  n: number,
  centros: (i: number) => Partial<Mediciones>,
  fijos: (i: number) => Partial<Mediciones> = () => ({}),
  semilla = 7,
): Lectura[] {
  const r = azar(semilla);
  const base: Mediciones = {
    ph: 7.2,
    temperatura: 22,
    conductividad: 450,
    turbidez: 0.6,
    tds: 290,
  };
  const amplitud: Mediciones = {
    ph: 0.1,
    temperatura: 0.6,
    conductividad: 16,
    turbidez: 0.3,
    tds: 10,
  };
  const decimales: Mediciones = { ph: 2, temperatura: 1, conductividad: 0, turbidez: 2, tds: 0 };
  return Array.from({ length: n }, (_, i) => {
    const c = { ...base, ...centros(i) };
    const ruidosa = Object.fromEntries(
      (Object.keys(base) as (keyof Mediciones)[]).map((p) => {
        const centro = c[p];
        const x =
          centro === null
            ? null
            : Number((centro + r() * (amplitud[p] as number)).toFixed(decimales[p] as number));
        return [p, x === null ? null : p === "turbidez" ? Math.max(0, x) : x];
      }),
    ) as Mediciones;
    return { ts: T0 + i * MINUTO, ...ruidosa, ...fijos(i) };
  });
}
const correr = (lecturas: Lectura[]) => evaluarSerie(perfil, lecturas);

describe("motor: arranque y estabilidad", () => {
  it("antes de tener lecturas suficientes el nivel es sin_datos", () => {
    const { resultados } = correr(serie(5, () => ({})));
    expect(resultados.slice(0, 2).map((r) => r.nivel)).toEqual(["sin_datos", "sin_datos"]);
    expect(resultados[2]?.nivel).toBe("buena");
  });

  it("agua estable: siempre buena, confianza ok, sin parámetro limitante", () => {
    const { resultados } = correr(serie(60, () => ({})));
    expect(transiciones(resultados.slice(2))).toEqual(["buena"]);
    const ultimo = resultados.at(-1);
    expect(ultimo).toMatchObject({ nivel: "buena", confianza: "ok", parametroLimitante: null });
    expect(ultimo?.wqi).toBeGreaterThan(95);
    expect(ultimo?.frase.accion).toBe("No necesitas hacer nada.");
  });

  it("ignora lecturas repetidas o anteriores (idempotencia ante reintentos)", () => {
    const lecturas = serie(10, () => ({}));
    const una = correr(lecturas);
    const duplicadas = correr([...lecturas, ...lecturas.slice(3)]);
    expect(duplicadas.resultados).toEqual(una.resultados);
    expect(duplicadas.estado).toEqual(una.estado);
  });

  it("el estado sobrevive a serializarse a JSON (Valkey) a mitad de la serie", () => {
    const lecturas = serie(40, (i) => (i >= 15 ? { turbidez: 9 } : {}));
    const entera = correr(lecturas);
    const mitad = correr(lecturas.slice(0, 20));
    const recuperado = JSON.parse(JSON.stringify(mitad.estado));
    const resto = evaluarSerie(perfil, lecturas.slice(20), recuperado);
    expect([...mitad.resultados, ...resto.resultados]).toEqual(entera.resultados);
  });
});

describe("motor: RF-21 sin cambios por una lectura aislada", () => {
  it("un pico aislado de turbidez, de pH y de TDS no cambia nada", () => {
    const { resultados } = correr(
      serie(
        60,
        () => ({}),
        (i) => (i === 20 ? { turbidez: 50, ph: 2 } : i === 30 ? { tds: 5000 } : {}),
      ),
    );
    expect(transiciones(resultados.slice(2))).toEqual(["buena"]);
  });

  it("dos lecturas malas seguidas tampoco bastan; un cambio sostenido sí", () => {
    const corto = correr(
      serie(
        40,
        () => ({}),
        (i) => (i === 20 || i === 21 ? { turbidez: 20 } : {}),
      ),
    );
    expect(transiciones(corto.resultados.slice(2))).toEqual(["buena"]);

    const sostenido = correr(serie(40, (i) => (i >= 20 ? { turbidez: 20 } : {})));
    expect(transiciones(sostenido.resultados.slice(2))).toEqual(["buena", "critica"]);
  });
});

describe("motor: RF-19 un parámetro crítico limita el nivel general", () => {
  it("pH muy alto con todo lo demás ideal es crítica aunque el promedio sea alto", () => {
    const { resultados } = correr(serie(30, () => ({ ph: 9.4 })));
    const ultimo = resultados.at(-1);
    expect(ultimo?.nivel).toBe("critica");
    expect(ultimo?.wqi).toBeGreaterThan(75); // el promedio engaña
    expect(ultimo?.parametroLimitante).toBe("ph");
  });

  it("la temperatura, con peso bajo, no limita el nivel por sí sola", () => {
    const { resultados } = correr(serie(30, () => ({ temperatura: 50 })));
    expect(resultados.at(-1)?.nivel).toBe("buena");
  });
});

describe("motor: histéresis (sin parpadeo)", () => {
  it("turbidez que sube poco a poco: empeora de a un nivel, sin regresar", () => {
    const { resultados } = correr(
      serie(70, (i) => ({ turbidez: i < 20 ? 0.6 : Math.min(12, 0.6 + (i - 20) * 0.57) })),
    );
    expect(transiciones(resultados.slice(2))).toEqual(["buena", "regular", "mala", "critica"]);
  });

  it("recuperación: empeora rápido y mejora más despacio", () => {
    const { resultados } = correr(serie(100, (i) => ({ turbidez: i >= 15 && i < 45 ? 9 : 0.6 })));
    expect(transiciones(resultados.slice(2))).toEqual(["buena", "mala", "buena"]);
    const iMala = resultados.findIndex((r) => r.nivel === "mala");
    const iVuelta = resultados.findIndex((r, i) => i > iMala && r.nivel === "buena");
    expect(iVuelta - 45).toBeGreaterThan(iMala - 15);
  });

  it("ruido alrededor del umbral: muy pocos cambios, mientras un nivel sin histéresis parpadearía", () => {
    const ruido = azar(1000);
    const lecturas = serie(120, (i) => ({ turbidez: i < 10 ? 0.6 : 4 + ruido() * 1.6 }));
    const { resultados } = correr(lecturas);
    expect(transiciones(resultados.slice(2)).length).toBeLessThanOrEqual(2);

    // referencia: el nivel instantáneo, lectura a lectura, sí parpadea muchas veces
    const crudos = lecturas
      .slice(10)
      .map((l) => ((l.turbidez as number) > 4 ? "regular" : "buena"));
    const cambiosCrudos = crudos.filter((x, i) => i > 0 && x !== crudos[i - 1]).length;
    expect(cambiosCrudos).toBeGreaterThan(20);
  });
});

describe("motor: confianza del sensor (RF-39)", () => {
  it("pH fuera de rango físico sostenido → revisar, y no se afirma un nivel bueno", () => {
    const { resultados } = correr(serie(40, (i) => (i >= 15 ? { ph: 15.3 } : {})));
    const ultimo = resultados.at(-1);
    expect(ultimo).toMatchObject({
      confianza: "revisar",
      nivel: "sin_datos",
      parametroLimitante: "ph",
    });
    expect(ultimo?.frase.causa).toContain("pH");
    expect(transiciones(resultados.slice(2))).toEqual(["buena", "sin_datos"]);
  });

  it("un valor fuera de rango suelto no es falla del sensor", () => {
    const { resultados } = correr(
      serie(
        40,
        () => ({}),
        (i) => (i === 20 ? { ph: 15.3 } : {}),
      ),
    );
    expect(resultados.every((r) => r.confianza === "ok")).toBe(true);
    expect(transiciones(resultados.slice(2))).toEqual(["buena"]);
  });

  it("sensor congelado (valor idéntico muchas lecturas) → revisar", () => {
    const { resultados } = correr(
      serie(
        40,
        () => ({}),
        (i) => (i >= 15 ? { ph: 7.2 } : {}),
      ),
    );
    const ultimo = resultados.at(-1);
    expect(ultimo).toMatchObject({
      confianza: "revisar",
      nivel: "sin_datos",
      parametroLimitante: "ph",
    });
    expect(ultimo?.invalidos).toEqual([{ parametro: "ph", motivo: "congelado" }]);
    // no se dispara de inmediato: hacen falta 10 lecturas iguales y la confirmación
    const primera = resultados.findIndex((r) => r.confianza === "revisar");
    expect(primera).toBeGreaterThanOrEqual(15 + 9);
  });

  it("nueve lecturas iguales todavía no son un sensor congelado", () => {
    const { resultados } = correr(
      serie(
        40,
        () => ({}),
        (i) => (i >= 15 && i < 24 ? { ph: 7.2 } : {}),
      ),
    );
    expect(resultados.every((r) => r.confianza === "ok")).toBe(true);
  });

  it("un sensor con problema no esconde un nivel malo de los demás", () => {
    const { resultados } = correr(serie(50, (i) => (i >= 10 ? { ph: 15.3, turbidez: 12 } : {})));
    const ultimo = resultados.at(-1);
    expect(ultimo).toMatchObject({
      confianza: "revisar",
      nivel: "critica",
      parametroLimitante: "turbidez",
    });
    expect(ultimo?.frase.accion).toMatch(/sensor de pH/);
  });

  it("un parámetro sin dato (RF-39) vuelve dudosa la confianza pero el resto sigue evaluándose", () => {
    const { resultados } = correr(serie(40, (i) => (i >= 15 ? { turbidez: null } : {})));
    expect(resultados.at(-1)).toMatchObject({ confianza: "dudosa", nivel: "buena" });
  });

  it("sin ninguna medición → sin_datos", () => {
    const nulas = { ph: null, temperatura: null, conductividad: null, turbidez: null, tds: null };
    const { resultados } = correr(serie(40, (i) => (i >= 15 ? nulas : {})));
    expect(resultados.at(-1)?.nivel).toBe("sin_datos");
    expect(transiciones(resultados.slice(2))).toEqual(["buena", "sin_datos"]);
  });

  it("al volver el sensor la confianza se recupera con histéresis, sin parpadear", () => {
    const { resultados } = correr(serie(80, (i) => (i >= 15 && i < 40 ? { ph: 15.3 } : {})));
    const conf = resultados.map((r) => r.confianza);
    const cambios = conf.filter((c, i) => i > 0 && c !== conf[i - 1]).length;
    expect(cambios).toBe(2); // ok → revisar → ok
    expect(resultados.at(-1)).toMatchObject({ confianza: "ok", nivel: "buena" });
  });
});
