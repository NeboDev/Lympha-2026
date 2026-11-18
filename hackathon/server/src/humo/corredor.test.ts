import { describe, expect, it } from "vitest";
import { codigoDeSalida, ejecutarPasos, lineaDe, type PasoHumo, resumenDe } from "./corredor.ts";

const ok = (nombre: string, detalle?: string): PasoHumo => ({
  nombre,
  correr: async () => detalle,
});
const falla = (nombre: string, mensaje: string): PasoHumo => ({
  nombre,
  correr: async () => {
    throw new Error(mensaje);
  },
});

/** Un reloj que avanza 1000 ms cada vez que se consulta. */
function reloj() {
  let t = 0;
  return () => {
    t += 1000;
    return t;
  };
}

describe("ejecutarPasos", () => {
  it("corre los pasos en orden y guarda el detalle y la duración de cada uno", async () => {
    const orden: string[] = [];
    const pasos: PasoHumo[] = ["a", "b", "c"].map((n) => ({
      nombre: n,
      correr: async () => {
        orden.push(n);
        return `detalle ${n}`;
      },
    }));
    const r = await ejecutarPasos(pasos, { ahoraMs: reloj() });
    expect(orden).toEqual(["a", "b", "c"]);
    expect(r.map((x) => [x.nombre, x.estado, x.detalle])).toEqual([
      ["a", "ok", "detalle a"],
      ["b", "ok", "detalle b"],
      ["c", "ok", "detalle c"],
    ]);
    expect(r.every((x) => x.ms === 1000)).toBe(true);
    expect(codigoDeSalida(r)).toBe(0);
  });

  it("un fallo detiene los pasos siguientes (quedan omitidos) pero los de limpieza sí corren", async () => {
    const limpieza: PasoHumo = {
      nombre: "limpiar",
      siempre: true,
      correr: async () => "datos de prueba borrados",
    };
    const r = await ejecutarPasos(
      [ok("uno"), falla("dos", "Blynk no respondió"), ok("tres"), limpieza],
      { ahoraMs: reloj() },
    );
    expect(r.map((x) => [x.nombre, x.estado])).toEqual([
      ["uno", "ok"],
      ["dos", "fallo"],
      ["tres", "omitido"],
      ["limpiar", "ok"],
    ]);
    expect(r[1]?.detalle).toBe("Blynk no respondió");
    expect(r[2]?.detalle).toContain("falló un paso anterior");
    expect(codigoDeSalida(r)).toBe(1);
  });

  it("si la limpieza misma falla, se reporta y la corrida sale con error", async () => {
    const r = await ejecutarPasos([
      ok("uno"),
      { ...falla("limpiar", "Mongo caído"), siempre: true },
    ]);
    expect(r[1]?.estado).toBe("fallo");
    expect(codigoDeSalida(r)).toBe(1);
  });

  it("un paso con detieneSiFalla=false no frena a los demás", async () => {
    const r = await ejecutarPasos([
      { ...falla("opcional", "sin Telegram"), detieneSiFalla: false },
      ok("siguiente"),
    ]);
    expect(r.map((x) => x.estado)).toEqual(["fallo", "ok"]);
    expect(codigoDeSalida(r)).toBe(1); // sigue contando como fallo
  });

  it("un paso que no corresponde se omite con su motivo y no cuenta como fallo", async () => {
    let corrio = false;
    const r = await ejecutarPasos([
      {
        nombre: "telegram",
        omitir: () => "sin --con-telegram",
        correr: async () => {
          corrio = true;
          return undefined;
        },
      },
      ok("pdf"),
    ]);
    expect(corrio).toBe(false);
    expect(r[0]).toMatchObject({ estado: "omitido", detalle: "sin --con-telegram" });
    expect(codigoDeSalida(r)).toBe(0);
  });

  it("un paso que se cuelga falla al pasar su tiempo máximo", async () => {
    const colgado: PasoHumo = {
      nombre: "colgado",
      esperaMaxMs: 20,
      correr: () => new Promise<string>(() => {}),
    };
    const r = await ejecutarPasos([colgado, ok("despues")]);
    expect(r[0]?.estado).toBe("fallo");
    expect(r[0]?.detalle).toMatch(/tiempo máximo/);
    expect(r[1]?.estado).toBe("omitido");
  });

  it("un error que no es Error se reporta sin romper el corredor", async () => {
    const raro: PasoHumo = {
      nombre: "raro",
      correr: async () => {
        throw "texto suelto";
      },
    };
    const r = await ejecutarPasos([raro]);
    expect(r[0]).toMatchObject({ estado: "fallo", detalle: "error desconocido" });
  });

  it("avisa cada paso al terminarlo, en vivo", async () => {
    const vistos: string[] = [];
    await ejecutarPasos([ok("a"), falla("b", "x")], {
      alTerminar: (r) => vistos.push(`${r.nombre}:${r.estado}`),
    });
    expect(vistos).toEqual(["a:ok", "b:fallo"]);
  });
});

describe("presentación", () => {
  it("lineaDe alinea símbolo, nombre, duración y detalle", () => {
    expect(lineaDe({ nombre: "MongoDB", estado: "ok", detalle: "responde", ms: 1234 })).toBe(
      `OK     ${"MongoDB".padEnd(38)}   1.2 s  responde`,
    );
    expect(lineaDe({ nombre: "Telegram", estado: "omitido", detalle: "sin bot", ms: 0 })).toContain(
      "omit.",
    );
    expect(
      lineaDe({ nombre: "x".repeat(60), estado: "fallo", detalle: "", ms: 0 }).length,
    ).toBeLessThan(80);
  });

  it("resumenDe cuenta y dice si hay fallos", () => {
    expect(
      resumenDe([
        { nombre: "a", estado: "ok", detalle: "", ms: 1 },
        { nombre: "b", estado: "omitido", detalle: "", ms: 1 },
      ]),
    ).toBe("Humo: todo en orden (1 bien · 0 con fallo · 1 omitidos).");
    expect(resumenDe([{ nombre: "a", estado: "fallo", detalle: "", ms: 1 }])).toContain(
      "HAY FALLOS",
    );
  });
});
