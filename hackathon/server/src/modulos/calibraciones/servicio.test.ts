import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { NoEncontrado, SinPermiso, SolicitudInvalida } from "../../dominio/errores.ts";
import { diagnosticarSonda } from "../../dominio/ph.ts";
import { catalogoDePrueba, nodoDePrueba, T0 } from "../../test/falsos.ts";
import type { NodoDoc, ServicioNodos } from "../nodos/index.ts";
import {
  type CalibracionDoc,
  crearServicioCalibraciones,
  type EventoCalibracion,
} from "./index.ts";

function escenario() {
  const nodo: NodoDoc = nodoDePrueba(new ObjectId(), "Tinaco azotea");
  const guardadas: { cal: CalibracionDoc; evento: EventoCalibracion }[] = [];
  const nodos: Pick<ServicioNodos, "acceso"> = {
    async acceso(uid, id, minimo = "integrante") {
      if (!id.equals(nodo._id) || !["ana", "beto"].includes(uid)) throw new NoEncontrado();
      if (uid === "beto" && minimo === "responsable") throw new SinPermiso();
      return { nodo, rol: uid === "ana" ? "responsable" : "integrante", comunidad: {} as never };
    },
  };
  const servicio = crearServicioCalibraciones({
    almacen: {
      async registrar(cal, evento) {
        guardadas.push({ cal, evento });
      },
      async listar(_id, limite) {
        return guardadas.map((g) => g.cal).slice(0, limite);
      },
    },
    nodos,
    catalogo: catalogoDePrueba,
    reloj: () => new Date(T0),
  });
  return { nodo, guardadas, servicio };
}

/** Sonda ideal a 25 °C: 59.16 mV/pH, 0 mV a pH 7 → pH 4 = +177.48 mV, pH 7 = 0. */
const ideal = [
  { valor: 4, mv: 177.48 },
  { valor: 7, mv: 0 },
];

describe("registrar", () => {
  it("calcula pendiente y offset, diagnostica y guarda la calibración con su evento", async () => {
    const e = escenario();
    const c = await e.servicio.registrar("ana", e.nodo._id, { parametro: "ph", puntos: ideal });
    expect(c).toMatchObject({
      parametro: "ph",
      temp: 25,
      pendiente_mv_por_ph: -59.16,
      offset_mv: 0,
      diagnostico: "buena",
      autor_uid: "ana",
      ts: new Date(T0),
    });
    expect(c.pendiente_pct_nernst).toBeCloseTo(100, 0);
    expect(e.guardadas).toHaveLength(1);
    expect(e.guardadas[0]?.evento).toMatchObject({
      tipo: "calibracion",
      severidad: "info",
      parametro: "ph",
      autor_uid: "ana",
      datos: { calibracion_id: c._id.toHexString(), diagnostico: "buena" },
    });
    expect(e.guardadas[0]?.evento.mensaje).toBe(
      "Calibración de pH registrada: diagnóstico «Buena» (100.0 % de Nernst).",
    );
  });

  it("una sonda gastada o con la pendiente invertida no sale como «buena»", async () => {
    const e = escenario();
    // ~90 % de Nernst: desgastada (entre 85 y 95).
    const gastada = await e.servicio.registrar("ana", e.nodo._id, {
      parametro: "ph",
      puntos: [
        { valor: 4, mv: 160 },
        { valor: 7, mv: 0 },
      ],
    });
    expect(gastada.diagnostico).toBe("desgastada");
    expect(e.guardadas[0]?.evento.severidad).toBe("atencion");
    // ~70 %: revisar.
    const mala = await e.servicio.registrar("ana", e.nodo._id, {
      parametro: "ph",
      puntos: [
        { valor: 4, mv: 125 },
        { valor: 7, mv: 0 },
      ],
    });
    expect(mala.diagnostico).toBe("revisar");
    // Pendiente positiva: cables invertidos.
    const invertida = await e.servicio.registrar("ana", e.nodo._id, {
      parametro: "ph",
      puntos: [
        { valor: 4, mv: -177 },
        { valor: 7, mv: 0 },
      ],
    });
    expect(invertida.diagnostico).toBe("revisar");
  });

  it("acepta una temperatura distinta, que cambia la pendiente de referencia", async () => {
    const e = escenario();
    const c = await e.servicio.registrar("ana", e.nodo._id, {
      parametro: "ph",
      puntos: ideal,
      tempC: 10,
    });
    expect(c.temp).toBe(10);
    expect(c.pendiente_pct_nernst).toBeGreaterThan(100); // a 10 °C la teórica es menor
  });

  it("solo el responsable calibra; un integrante recibe 403 y un ajeno 404", async () => {
    const e = escenario();
    await expect(
      e.servicio.registrar("beto", e.nodo._id, { parametro: "ph", puntos: ideal }),
    ).rejects.toBeInstanceOf(SinPermiso);
    await expect(
      e.servicio.registrar("intruso", e.nodo._id, { parametro: "ph", puntos: ideal }),
    ).rejects.toBeInstanceOf(NoEncontrado);
    expect(e.guardadas).toHaveLength(0);
  });

  it.each([
    ["un parámetro que el nodo no mide", { parametro: "turbidez", puntos: ideal }],
    ["un parámetro desconocido", { parametro: "oro", puntos: ideal }],
    ["un solo punto", { parametro: "ph", puntos: [{ valor: 7, mv: 0 }] }],
    ["tres puntos", { parametro: "ph", puntos: [...ideal, { valor: 10, mv: -177 }] }],
    [
      "dos buffers iguales",
      {
        parametro: "ph",
        puntos: [
          { valor: 7, mv: 0 },
          { valor: 7, mv: 5 },
        ],
      },
    ],
    [
      "un pH fuera de 0 a 14",
      {
        parametro: "ph",
        puntos: [
          { valor: 15, mv: 0 },
          { valor: 7, mv: 0 },
        ],
      },
    ],
    [
      "milivoltios imposibles",
      {
        parametro: "ph",
        puntos: [
          { valor: 4, mv: 99_999 },
          { valor: 7, mv: 0 },
        ],
      },
    ],
    [
      "un valor que no es número",
      {
        parametro: "ph",
        puntos: [
          { valor: Number.NaN, mv: 0 },
          { valor: 7, mv: 0 },
        ],
      },
    ],
    ["una temperatura imposible", { parametro: "ph", puntos: ideal, tempC: 90 }],
  ])("rechaza %s", async (_nombre, datos) => {
    const e = escenario();
    await expect(e.servicio.registrar("ana", e.nodo._id, datos)).rejects.toBeInstanceOf(
      SolicitudInvalida,
    );
    expect(e.guardadas).toHaveLength(0);
  });
});

describe("listar", () => {
  it("cualquier miembro puede ver las calibraciones; un ajeno no", async () => {
    const e = escenario();
    await e.servicio.registrar("ana", e.nodo._id, { parametro: "ph", puntos: ideal });
    expect(await e.servicio.listar("beto", e.nodo._id)).toHaveLength(1);
    await expect(e.servicio.listar("intruso", e.nodo._id)).rejects.toBeInstanceOf(NoEncontrado);
  });
});

describe("diagnosticarSonda", () => {
  const cal = (pct: number, mvPorPh = -59) => ({
    pendienteMvPorPh: mvPorPh,
    pendientePctNernst: pct,
  });
  it("usa los umbrales que se le pasan, inclusivos por abajo", () => {
    expect(diagnosticarSonda(cal(95), 85, 95)).toBe("buena");
    expect(diagnosticarSonda(cal(94.9), 85, 95)).toBe("desgastada");
    expect(diagnosticarSonda(cal(85), 85, 95)).toBe("desgastada");
    expect(diagnosticarSonda(cal(84.9), 85, 95)).toBe("revisar");
    expect(diagnosticarSonda(cal(100, 0), 85, 95)).toBe("revisar");
    expect(diagnosticarSonda(cal(100, 59), 85, 95)).toBe("revisar");
  });
});
