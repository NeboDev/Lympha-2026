import type { EstadoNodoEvento, EventoConexion, NodoApi } from "@lympha/contracts";
import { describe, expect, it } from "vitest";
import {
  combinar,
  conConexion,
  conEstado,
  conSnapshot,
  estadoVisible,
  sseVacio,
} from "./estado.ts";
import { haceCuanto, horaYDia } from "./tiempo.ts";

const N1 = "0192f3a7-0000-7000-8000-00000000e001";
const N2 = "0192f3a7-0000-7000-8000-00000000e002";
const ESPACIO = "0192f3a7-0000-7000-8000-00000000a0e1";
const T0 = "2026-10-15T10:00:00.000Z";
const T1 = "2026-10-15T10:05:00.000Z";

function nodo(id: string, extra: Partial<NodoApi> = {}): NodoApi {
  return {
    id,
    espacio_id: ESPACIO,
    nombre: "Cisterna",
    perfil_id: "cisterna",
    estado: "activo",
    version_fw: null,
    reclamado_en: T0,
    estado_actual: {
      conectado: true,
      cambio_conexion_en: T0,
      ultima_lectura_en: T0,
      nivel: "buena",
      wqi: 91,
      parametro_limitante: null,
      confianza: "ok",
      causa: "Todo en orden.",
      accion: null,
      ultimos_valores: null,
    },
    ...extra,
  };
}

const evento = (id: string, extra: Partial<EstadoNodoEvento> = {}): EstadoNodoEvento => ({
  nodo_id: id,
  espacio_id: ESPACIO,
  nivel: "critica",
  wqi: 30,
  confianza: "ok",
  parametro_limitante: "turbidez",
  causa: "El agua está turbia.",
  accion: "No la uses para beber.",
  ultima_lectura_en: T1,
  valores: null,
  actualizado_en: T1,
  ...extra,
});

const conexion = (id: string, conectado: boolean): EventoConexion => ({
  nodo_id: id,
  espacio_id: ESPACIO,
  conectado,
  cambio_conexion_en: T1,
  actualizado_en: T1,
});

describe("estadoVisible", () => {
  it("un nodo activo y conectado muestra su nivel", () => {
    for (const nivel of ["buena", "regular", "mala", "critica"] as const) {
      expect(estadoVisible("activo", nivel, "ok", true)).toBe(nivel);
    }
  });

  it("sin conexión manda sobre el último nivel (el dato ya no es de ahora)", () => {
    expect(estadoVisible("activo", "buena", "ok", false)).toBe("sin_conexion");
    expect(estadoVisible("activo", "critica", "ok", false)).toBe("sin_conexion");
  });

  it("con el sensor por revisar y sin nivel que afirmar, dice «revisar»; sin sensor culpable, «sin datos»", () => {
    expect(estadoVisible("activo", "sin_datos", "revisar", true)).toBe("revisar");
    expect(estadoVisible("activo", "sin_datos", "ok", true)).toBe("sin_datos");
  });

  it("un nivel malo o crítico se conserva aunque haya un sensor por revisar", () => {
    expect(estadoVisible("activo", "critica", "revisar", true)).toBe("critica");
  });

  it("los estados del ciclo de vida mandan sobre todo lo demás", () => {
    expect(estadoVisible("reclamado", "sin_datos", "ok", null)).toBe("esperando");
    expect(estadoVisible("revocado", "buena", "ok", true)).toBe("deshabilitado");
    expect(estadoVisible("desvinculado", "buena", "ok", true)).toBe("sin_vincular");
    expect(estadoVisible("fabricado", "sin_datos", "ok", null)).toBe("sin_vincular");
  });
});

describe("combinar", () => {
  const baseEn = 1000;

  it("sin datos en vivo, muestra lo que dijo la API", () => {
    const [v] = combinar([nodo(N1)], sseVacio, baseEn);
    expect(v).toMatchObject({
      visible: "buena",
      wqi: 91,
      causa: "Todo en orden.",
      nombre: "Cisterna",
      sinDatosDesde: null,
    });
  });

  it("el estado en vivo reemplaza el de la API y conserva el nombre", () => {
    const sse = conEstado(sseVacio, evento(N1), 2000);
    const [v] = combinar([nodo(N1)], sse, baseEn);
    expect(v).toMatchObject({
      visible: "critica",
      wqi: 30,
      parametroLimitante: "turbidez",
      causa: "El agua está turbia.",
      nombre: "Cisterna",
    });
  });

  it("una caída en vivo pone el nodo sin conexión, con desde cuándo", () => {
    const sse = conConexion(sseVacio, conexion(N1, false), 2000);
    const [v] = combinar([nodo(N1)], sse, baseEn);
    expect(v).toMatchObject({ visible: "sin_conexion", sinDatosDesde: T1 });
  });

  it("al volver la conexión, el nodo recupera su nivel", () => {
    let sse = conConexion(sseVacio, conexion(N1, false), 2000);
    sse = conConexion(sse, conexion(N1, true), 3000);
    const [v] = combinar([nodo(N1)], sse, baseEn);
    expect(v?.visible).toBe("buena");
    expect(v?.sinDatosDesde).toBeNull();
  });

  it("lo que llegó ANTES de la última respuesta de la API se ignora: la respuesta es más nueva", () => {
    const sse = conEstado(sseVacio, evento(N1), 500);
    const [v] = combinar([nodo(N1)], sse, baseEn);
    expect(v?.visible).toBe("buena");
  });

  it("el snapshot reemplaza todo lo anterior y no mezcla nodos entre sí", () => {
    let sse = conEstado(sseVacio, evento(N2, { nivel: "mala" }), 2000);
    sse = conSnapshot(
      {
        nodos: [evento(N1, { nivel: "regular" })],
        conexiones: [{ nodo_id: N1, conectado: true, cambio_conexion_en: T0 }],
      },
      3000,
    );
    const vistas = combinar([nodo(N1), nodo(N2)], sse, baseEn);
    expect(vistas.map((x) => x.visible)).toEqual(["regular", "buena"]);
  });

  it("un sensor por revisar con nivel conservado se marca aparte", () => {
    const sse = conEstado(
      sseVacio,
      evento(N1, { confianza: "revisar", parametro_limitante: "ph" }),
      2000,
    );
    const [v] = combinar([nodo(N1)], sse, baseEn);
    expect(v).toMatchObject({ visible: "critica", sensorPorRevisar: true });
  });

  it("un nodo reclamado deja de esperar cuando llega su primera evaluación en vivo", () => {
    const base = [nodo(N1, { estado: "reclamado", estado_actual: null })];
    const sse = conEstado(sseVacio, evento(N1, { nivel: "buena", wqi: 90 }), 2000);
    expect(combinar(base, sse, baseEn)[0]?.visible).toBe("buena");
  });

  it("el snapshot trae una fila para el nodo que aún no ha mandado nada: sigue esperando, no «sin conexión»", () => {
    const base = [nodo(N1, { estado: "reclamado", estado_actual: null })];
    const sse = conSnapshot(
      {
        nodos: [evento(N1, { nivel: "sin_datos", wqi: null, ultima_lectura_en: null })],
        conexiones: [{ nodo_id: N1, conectado: false, cambio_conexion_en: null }],
      },
      2000,
    );
    expect(combinar(base, sse, baseEn)[0]?.visible).toBe("esperando");
  });

  it("un nodo recién reclamado, sin estado, espera su primera lectura", () => {
    const [v] = combinar(
      [nodo(N1, { estado: "reclamado", estado_actual: null })],
      sseVacio,
      baseEn,
    );
    expect(v?.visible).toBe("esperando");
  });
});

describe("tiempo", () => {
  const ahora = new Date("2026-10-15T12:00:00.000Z").getTime();
  const antes = (ms: number) => new Date(ahora - ms).toISOString();

  it("haceCuanto escala de segundos a días", () => {
    expect(haceCuanto(antes(10_000), ahora)).toBe("hace unos segundos");
    expect(haceCuanto(antes(5 * 60_000), ahora)).toBe("hace 5 min");
    expect(haceCuanto(antes(3 * 3_600_000), ahora)).toBe("hace 3 h");
    expect(haceCuanto(antes(24 * 3_600_000), ahora)).toBe("hace 1 día");
    expect(haceCuanto(antes(3 * 24 * 3_600_000), ahora)).toBe("hace 3 días");
  });

  it("un reloj adelantado no da tiempos negativos", () => {
    expect(haceCuanto(new Date(ahora + 60_000).toISOString(), ahora)).toBe("hace unos segundos");
  });

  it("horaYDia solo agrega el día si no es de hoy", () => {
    expect(horaYDia(antes(60_000), ahora)).not.toMatch(/,/);
    expect(horaYDia(antes(3 * 24 * 3_600_000), ahora)).toMatch(/,/);
  });
});
