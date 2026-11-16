import { describe, expect, it } from "vitest";
import { parametroDe } from "../../dominio/catalogo.ts";
import { cargarCatalogo } from "../../plataforma/catalogo.ts";
import { type Estado, evaluar, type Lectura } from "./index.ts";

const ph = parametroDe(cargarCatalogo(), "ph");
function exigir<T>(valor: T | null | undefined, mensaje: string): T {
  if (valor === null || valor === undefined) throw new Error(mensaje);
  return valor;
}
const reglas = exigir(ph.reglas, "El catálogo de pH debe traer reglas");
const normaPh = exigir(ph.norma, "El catálogo de pH debe traer norma");
const norma = { min: normaPh.min, max: normaPh.max };

const T0 = Date.UTC(2026, 10, 19, 15, 0, 0);

/** Serie con un paso fijo (30 s por defecto); la última lectura es la más reciente. */
function serie(valores: number[], pasoS = 30): Lectura[] {
  return valores.map((valor, i) => ({ ts: new Date(T0 + i * pasoS * 1000), valor }));
}
const repetir = (v: number, n: number) => Array.from({ length: n }, () => v);
/** Ruido determinista pequeño para que no cuente como «sensor pegado». */
const ruido = (v: number, n: number) =>
  Array.from({ length: n }, (_, i) => v + (i % 2 ? 0.004 : -0.004));

function ev(
  valores: number[],
  previo: Estado | null = null,
  extra: Partial<Parameters<typeof evaluar>[0]> = {},
) {
  return evaluar({ norma, reglas, ventana: serie(valores), previo, ...extra });
}

describe("rangos", () => {
  it("en rango y estable", () => {
    const r = ev(ruido(7.2, 20));
    expect(r.estado).toBe("en_rango");
    expect(r.estable).toBe(true);
    expect(r.distanciaFuera).toBeLessThan(0);
  });

  it("atención a menos de 0.3 del límite aunque siga dentro", () => {
    expect(ev(ruido(6.7, 20), "en_rango").estado).toBe("atencion");
    expect(ev(ruido(8.3, 20), "en_rango").estado).toBe("atencion");
  });

  it("fuera de rango por debajo y por encima", () => {
    expect(ev(ruido(6.2, 20), "en_rango").estado).toBe("fuera_de_rango");
    expect(ev(ruido(8.8, 20), "en_rango").estado).toBe("fuera_de_rango");
  });

  it("crítico a más de 1.0 fuera del rango; justo en 1.0 aún es fuera de rango", () => {
    expect(ev(ruido(5.3, 20), "fuera_de_rango").estado).toBe("critico");
    expect(ev(ruido(9.7, 20), "fuera_de_rango").estado).toBe("critico");
    expect(ev([...ruido(7, 10), 5.5, 5.5, 5.5], "en_rango").estado).toBe("fuera_de_rango");
  });

  it("los límites exactos de la norma (6.5 y 8.5) cuentan como dentro", () => {
    expect(ev(ruido(6.5, 20), "atencion").estado).toBe("atencion");
  });

  it("es genérico: sirve con un límite nulo (p. ej. solo máximo)", () => {
    const r = evaluar({
      norma: { min: null, max: 4 },
      reglas,
      ventana: serie(ruido(4.5, 20)),
      previo: "en_rango",
    });
    expect(r.estado).toBe("fuera_de_rango");
    const bien = evaluar({ norma: { min: null, max: 4 }, reglas, ventana: serie(ruido(1, 20)) });
    expect(bien.estado).toBe("en_rango");
  });
});

describe("entrada con N lecturas consecutivas", () => {
  it("dos lecturas malas no bastan; tres sí", () => {
    expect(ev([...ruido(7, 10), 6.2, 6.21], "en_rango").estado).toBe("en_rango");
    expect(ev([...ruido(7, 10), 6.2, 6.21, 6.19], "en_rango").estado).toBe("fuera_de_rango");
  });

  it("una lectura suelta fuera no cambia el estado", () => {
    expect(ev([...ruido(7, 10), 6.2, 7.0, 7.01], "en_rango").estado).toBe("en_rango");
  });

  it("lo crítico entra de inmediato, con una sola lectura", () => {
    const r = ev([...ruido(7, 10), 5.0], "en_rango");
    expect(r.estado).toBe("critico");
  });

  it("sin previo (primera evaluación) toma la lectura tal cual", () => {
    expect(ev([6.2]).estado).toBe("fuera_de_rango");
  });
});

describe("histéresis al salir", () => {
  it("de fuera de rango: sigue fuera hasta entrar 0.1 al rango", () => {
    expect(ev(ruido(6.55, 20), "fuera_de_rango").estado).toBe("fuera_de_rango");
    // 6.7 ya está a 0.2 dentro: sale, pero queda en atención (margen 0.3).
    expect(ev(ruido(6.7, 20), "fuera_de_rango").estado).toBe("atencion");
    expect(ev(ruido(7.2, 20), "fuera_de_rango").estado).toBe("en_rango");
  });

  it("de crítico: baja a fuera de rango solo al volver por debajo de 0.9", () => {
    expect(ev(ruido(5.55, 20), "critico").estado).toBe("critico"); // 0.95 fuera
    expect(ev(ruido(5.7, 20), "critico").estado).toBe("fuera_de_rango"); // 0.8 fuera
  });

  it("de atención: sale de la franja con 0.1 de colchón", () => {
    expect(ev(ruido(6.85, 20), "atencion").estado).toBe("atencion"); // 0.35 del límite
    expect(ev(ruido(6.95, 20), "atencion").estado).toBe("en_rango"); // 0.45 del límite
  });

  it("no parpadea cuando la lectura oscila en el borde", () => {
    const borde = Array.from({ length: 24 }, (_, i) => (i % 2 ? 6.55 : 6.45));
    expect(ev(borde, "fuera_de_rango").estado).toBe("fuera_de_rango");
  });
});

describe("cambio rápido", () => {
  const salto = [...repetir(7.0, 20), 7.6, 7.61, 7.62];

  it("sube a atención aunque siga lejos de los límites", () => {
    const r = ev(salto, "en_rango");
    expect(r.cambioRapido).toBe(true);
    expect(r.cambio).toBeGreaterThan(0.5);
    expect(r.estado).toBe("atencion");
  });

  it("una deriva lenta (0.3 en 5 min) no cuenta", () => {
    const lenta = Array.from({ length: 30 }, (_, i) => 7 + i * 0.03);
    expect(ev(lenta, "en_rango").cambioRapido).toBe(false);
  });

  it("sin una lectura de hace 5 min no hay cambio que medir", () => {
    const corta = ev([7.0, 7.9]);
    expect(corta.cambio).toBeNull();
    expect(corta.cambioRapido).toBe(false);
  });
});

describe("estabilidad", () => {
  it("estable si casi no se mueve", () => {
    expect(ev(ruido(7.2, 20)).estable).toBe(true);
  });

  it("no estable si oscila más de 0.02", () => {
    const vaiven = Array.from({ length: 20 }, (_, i) => (i % 2 ? 7.1 : 7.3));
    expect(ev(vaiven).estable).toBe(false);
  });

  it("no estable con pocas lecturas", () => {
    expect(ev(ruido(7.2, 5)).estable).toBe(false);
  });
});

describe("sensor degradado", () => {
  it("lecturas pegadas a un riel", () => {
    const a = ev([...ruido(7, 10), 0, 0.01, 0], "en_rango");
    expect(a.estado).toBe("revisar_sensor");
    expect(a.motivosSensor).toContain("riel");
    const b = ev([...ruido(7, 10), 14, 13.99, 14], "en_rango");
    expect(b.estado).toBe("revisar_sensor");
  });

  it("valor imposible o no numérico", () => {
    expect(ev([...ruido(7, 10), 15], "en_rango").motivosSensor).toContain("fuera_fisico");
    expect(ev([...ruido(7, 10), Number.NaN], "en_rango").estado).toBe("revisar_sensor");
  });

  it("lecturas idénticas demasiado tiempo (sensor pegado)", () => {
    const r = ev(repetir(7.123, 120), "en_rango");
    expect(r.estado).toBe("revisar_sensor");
    expect(r.motivosSensor).toContain("pegado");
    expect(ev(repetir(7.123, 119), "en_rango").estado).toBe("en_rango");
  });

  it("la regla de pegado se apaga con 0", () => {
    const sin = evaluar({
      norma,
      reglas: { ...reglas, lecturas_pegadas: 0 },
      ventana: serie(repetir(7.123, 300)),
    });
    expect(sin.estado).toBe("en_rango");
  });

  it("calibración con pendiente menor a 85 % de Nernst", () => {
    const mala = ev(ruido(7, 20), "en_rango", { pendientePctNernst: 84.9 });
    expect(mala.estado).toBe("revisar_sensor");
    expect(mala.motivosSensor).toContain("calibracion");
    expect(ev(ruido(7, 20), "en_rango", { pendientePctNernst: 85 }).estado).toBe("en_rango");
    expect(ev(ruido(7, 20), "en_rango", { pendientePctNernst: null }).estado).toBe("en_rango");
  });

  it("el nodo reporta error de sensor (estado 3)", () => {
    const r = ev(ruido(7, 20), "en_rango", { estadoNodo: 3 });
    expect(r.motivosSensor).toContain("nodo");
  });

  it("revisar sensor tiene prioridad sobre crítico y nunca es estable", () => {
    const r = ev([5, 5, 0, 0, 0], "critico");
    expect(r.estado).toBe("revisar_sensor");
    expect(r.estable).toBe(false);
  });

  it("al recuperarse el sensor, la evaluación parte sin memoria", () => {
    const r = ev(ruido(7.2, 20), "revisar_sensor");
    expect(r.estado).toBe("en_rango");
    expect(r.motivosSensor).toEqual([]);
  });
});

describe("entrada", () => {
  it("una ventana vacía es un error", () => {
    expect(() => evaluar({ norma, reglas, ventana: [] })).toThrow(/vacía/);
  });

  it("ordena la ventana por fecha", () => {
    const desordenada = serie(ruido(7, 12)).reverse();
    expect(evaluar({ norma, reglas, ventana: desordenada }).estado).toBe("en_rango");
  });

  it("no modifica la ventana recibida", () => {
    const v = serie(ruido(7, 12)).reverse();
    const copia = [...v];
    evaluar({ norma, reglas, ventana: v });
    expect(v).toEqual(copia);
  });
});
