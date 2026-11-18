import { describe, expect, it } from "vitest";
import { catalogoDePrueba, nodoDePrueba, T0 } from "../../test/falsos.ts";
import type { ConfigActuador, NodoDoc, UltimoNodo } from "../nodos/index.ts";
import { bloqueos, conexionDe, duracionValida, motivoParaDetener } from "./reglas.ts";

const AHORA = new Date(T0);
const CONFIG: ConfigActuador = {
  habilitado: true,
  nombre: "Bomba de cloro",
  pin: "v8",
  pulso_max_s: 30,
  enfriamiento_s: 300,
  simulado: true,
  auto_detener: true,
};

function nodo(
  parcial: {
    estado?: UltimoNodo["estado"];
    sinDatos?: boolean;
    sinLecturas?: boolean;
    config?: ConfigActuador | null;
  } = {},
): NodoDoc {
  const n = nodoDePrueba();
  void catalogoDePrueba;
  const config = parcial.config === undefined ? CONFIG : parcial.config;
  return {
    ...n,
    ...(config ? { actuador: config } : {}),
    ultimo: parcial.sinLecturas
      ? null
      : {
          ts: AHORA,
          v: { ph: 7.2 },
          estado: parcial.estado === undefined ? "en_rango" : parcial.estado,
          estados: {},
          seq: 1,
          sesion: 0,
          estable: true,
          ultimo_cambio: AHORA,
          sin_datos: parcial.sinDatos ?? false,
        },
  };
}

const codigos = (
  n: NodoDoc,
  activa: { estado: "en_curso" | "pendiente" } | null = null,
  fin: Date | null = null,
) => bloqueos(n, activa, fin, AHORA).map((b) => b.codigo);

describe("bloqueos", () => {
  it("con el agua en rango o en atención y sin nada en curso, se puede dosificar", () => {
    expect(codigos(nodo({ estado: "en_rango" }))).toEqual([]);
    expect(codigos(nodo({ estado: "atencion" }))).toEqual([]);
  });

  it("sin actuador o con el actuador deshabilitado, no", () => {
    expect(codigos(nodo({ config: null }))).toEqual(["sin_actuador"]);
    expect(codigos(nodo({ config: { ...CONFIG, habilitado: false } }))).toEqual(["sin_actuador"]);
  });

  it("sin datos válidos no se dosifica: nodo sin lecturas, detenido o sin estado evaluado", () => {
    expect(codigos(nodo({ sinLecturas: true }))).toEqual(["sin_datos"]);
    expect(codigos(nodo({ sinDatos: true }))).toEqual(["sin_datos"]);
    expect(codigos(nodo({ estado: null }))).toEqual(["sin_datos"]);
  });

  it("con la sonda dudosa o el agua fuera de rango no se dosifica, y dice por qué", () => {
    expect(codigos(nodo({ estado: "revisar_sensor" }))).toEqual(["sensor"]);
    expect(codigos(nodo({ estado: "fuera_de_rango" }))).toEqual(["fuera_de_rango"]);
    expect(codigos(nodo({ estado: "critico" }))).toEqual(["fuera_de_rango"]);
    const [b] = bloqueos(nodo({ estado: "critico" }), null, null, AHORA);
    expect(b?.mensaje).toMatch(/corregir el pH/);
  });

  it("un pulso en curso bloquea; uno pendiente (el que se está confirmando) no", () => {
    expect(codigos(nodo(), { estado: "en_curso" })).toEqual(["pulso_en_curso"]);
    expect(codigos(nodo(), { estado: "pendiente" })).toEqual([]);
  });

  it("el enfriamiento cuenta los segundos que faltan desde el fin del pulso anterior", () => {
    const hace100 = new Date(AHORA.getTime() - 100_000);
    const r = bloqueos(nodo(), null, hace100, AHORA);
    expect(r.map((b) => b.codigo)).toEqual(["enfriamiento"]);
    expect(r[0]?.mensaje).toContain("4 min");
    expect(codigos(nodo(), null, new Date(AHORA.getTime() - 300_000))).toEqual([]); // justo cumplido
    expect(codigos(nodo({ config: { ...CONFIG, enfriamiento_s: 0 } }), null, AHORA)).toEqual([]);
  });

  it("junta varios motivos a la vez", () => {
    expect(codigos(nodo({ estado: "critico" }), { estado: "en_curso" })).toEqual([
      "fuera_de_rango",
      "pulso_en_curso",
    ]);
  });
});

describe("motivoParaDetener", () => {
  const en_curso = { estado: "en_curso" as const };

  it("detiene un pulso en curso si el pH sale de rango, la sonda falla o el nodo se calla", () => {
    expect(motivoParaDetener(nodo({ estado: "fuera_de_rango" }), en_curso)).toBe("fuera_de_rango");
    expect(motivoParaDetener(nodo({ estado: "critico" }), en_curso)).toBe("fuera_de_rango");
    expect(motivoParaDetener(nodo({ estado: "revisar_sensor" }), en_curso)).toBe("sensor");
    expect(motivoParaDetener(nodo({ sinDatos: true }), en_curso)).toBe("sin_datos");
  });

  it("con el agua en rango o en atención, un pulso sigue", () => {
    expect(motivoParaDetener(nodo({ estado: "en_rango" }), en_curso)).toBeNull();
    expect(motivoParaDetener(nodo({ estado: "atencion" }), en_curso)).toBeNull();
  });

  it("no hace nada sin pulso en curso (una solicitud pendiente todavía no mandó nada)", () => {
    expect(motivoParaDetener(nodo({ estado: "critico" }), null)).toBeNull();
    expect(motivoParaDetener(nodo({ estado: "critico" }), { estado: "pendiente" })).toBeNull();
  });

  it("respeta la configuración: sin auto_detener o con el actuador apagado, no actúa", () => {
    expect(
      motivoParaDetener(
        nodo({ estado: "critico", config: { ...CONFIG, auto_detener: false } }),
        en_curso,
      ),
    ).toBeNull();
    expect(
      motivoParaDetener(
        nodo({ estado: "critico", config: { ...CONFIG, habilitado: false } }),
        en_curso,
      ),
    ).toBeNull();
    expect(motivoParaDetener(nodo({ estado: "critico", config: null }), en_curso)).toBeNull();
  });
});

describe("duracionValida y conexionDe", () => {
  it("el pulso es entero y va de 1 s al máximo del nodo", () => {
    for (const bien of [1, 15, 30]) expect(duracionValida(CONFIG, bien), String(bien)).toBe(true);
    for (const mal of [0, -5, 31, 2.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(duracionValida(CONFIG, mal), String(mal)).toBe(false);
  });

  it("conexionDe distingue sin lecturas, conectado y sin datos", () => {
    expect(conexionDe(nodo({ sinLecturas: true }))).toBe("sin_lecturas");
    expect(conexionDe(nodo())).toBe("conectado");
    expect(conexionDe(nodo({ sinDatos: true }))).toBe("sin_datos");
  });
});
