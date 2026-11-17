import { describe, expect, it } from "vitest";
import { cargarCatalogo } from "../../plataforma/catalogo.ts";
import { mapeoPorDefecto } from "../nodos/index.ts";
import { decidirCiclo, ESTADO_CICLO_INICIAL, type EstadoCiclo } from "./ciclo.ts";

const mapeo = mapeoPorDefecto(cargarCatalogo(), ["ph"]);
const T = (s: number) => new Date(Date.UTC(2026, 10, 19, 15, 0, 0) + s * 1000);
const SIN_DATOS_S = 60;

const foto = (seq: number | string, extra: Record<string, number | string> = {}) => ({
  v2: 7.1,
  v7: 7.15,
  v4: 0,
  v5: 1,
  v6: seq,
  ...extra,
});

const ciclo = (estado: EstadoCiclo, snapshot: ReturnType<typeof foto>, s: number) =>
  decidirCiclo({ estado, snapshot, mapeo, ahora: T(s), sinDatosS: SIN_DATOS_S });

describe("decidirCiclo", () => {
  it("la primera lectura se acepta y arma la muestra desde el mapeo", () => {
    const r = ciclo(ESTADO_CICLO_INICIAL, foto(10), 0);
    expect(r.tipo).toBe("muestra");
    if (r.tipo !== "muestra") return;
    expect(r.muestra).toMatchObject({
      seq: 10,
      sesion: 0,
      v: { ph: 7.1 },
      crudo: { ph: 7.15 },
      estadoNodo: 0,
      estableNodo: true,
    });
    expect(r.muestra.ts).toEqual(T(0));
    expect(r.evento).toBeNull();
    expect(r.reinicio).toBe(false);
    expect(r.siguiente).toEqual({ seq: 10, sesion: 0, ultimoCambio: T(0), sinDatos: false });
  });

  it("un seq que avanza es una muestra nueva", () => {
    const e = ciclo(ESTADO_CICLO_INICIAL, foto(10), 0).siguiente;
    const r = ciclo(e, foto(11), 5);
    expect(r.tipo).toBe("muestra");
  });

  it("el mismo seq no es muestra nueva (no se duplica)", () => {
    const e = ciclo(ESTADO_CICLO_INICIAL, foto(10), 0).siguiente;
    const r = ciclo(e, foto(10), 5);
    expect(r.tipo).toBe("sin_cambio");
    expect(r.siguiente).toEqual(e);
  });

  it("avisa «sin datos» una sola vez al pasar el umbral", () => {
    let e = ciclo(ESTADO_CICLO_INICIAL, foto(10), 0).siguiente;
    const antes = ciclo(e, foto(10), 60); // justo en el umbral: aún no
    expect(antes.tipo === "sin_cambio" && antes.evento).toBeNull();
    const r = ciclo(e, foto(10), 61);
    expect(r.tipo === "sin_cambio" && r.evento).toBe("sin_datos");
    e = r.siguiente;
    const otra = ciclo(e, foto(10), 120);
    expect(otra.tipo === "sin_cambio" && otra.evento).toBeNull();
    expect(otra.tipo === "sin_cambio" && otra.silencioS).toBe(120);
  });

  it("al volver a cambiar el seq tras estar detenido, hay reconexión", () => {
    let e = ciclo(ESTADO_CICLO_INICIAL, foto(10), 0).siguiente;
    e = ciclo(e, foto(10), 90).siguiente; // ya marcado sin datos
    const r = ciclo(e, foto(11), 100);
    expect(r.tipo === "muestra" && r.evento).toBe("reconexion");
    expect(r.siguiente.sinDatos).toBe(false);
  });

  it("si el seq baja, el nodo se reinició: nueva sesión", () => {
    let e = ciclo(ESTADO_CICLO_INICIAL, foto(500), 0).siguiente;
    const r = ciclo(e, foto(1), 5);
    expect(r.tipo).toBe("muestra");
    if (r.tipo !== "muestra") return;
    expect(r.reinicio).toBe(true);
    expect(r.muestra.sesion).toBe(1);
    e = r.siguiente;
    expect(ciclo(e, foto(2), 10).siguiente.sesion).toBe(1);
  });

  it("un reinicio tras estar detenido da muestra con reconexión y sesión nueva", () => {
    let e = ciclo(ESTADO_CICLO_INICIAL, foto(500), 0).siguiente;
    e = ciclo(e, foto(500), 90).siguiente;
    const r = ciclo(e, foto(1), 100);
    expect(r.tipo === "muestra" && r.evento).toBe("reconexion");
    expect(r.tipo === "muestra" && r.reinicio).toBe(true);
  });

  it("seq ausente, negativo, decimal o no numérico es inválido y no cambia el estado", () => {
    const e = ciclo(ESTADO_CICLO_INICIAL, foto(10), 0).siguiente;
    for (const malo of [undefined, -1, 1.5, "abc", ""]) {
      const snap = { ...foto(10), v6: malo } as Record<string, number | string>;
      if (malo === undefined) delete snap.v6;
      const r = decidirCiclo({ estado: e, snapshot: snap, mapeo, ahora: T(5), sinDatosS: 60 });
      expect(r.tipo).toBe("invalida");
      expect(r.siguiente).toEqual(e);
    }
  });

  it("acepta números que Blynk entrega como texto", () => {
    const r = ciclo(ESTADO_CICLO_INICIAL, foto("12", { v2: "6.80" }), 0);
    expect(r.tipo === "muestra" && r.muestra.seq).toBe(12);
    expect(r.tipo === "muestra" && r.muestra.v.ph).toBe(6.8);
  });

  it("un pin de pH que falta deja `v` sin ph (la evaluación lo tratará como sensor)", () => {
    const snap = foto(3);
    const { v2: _omitido, ...sinPh } = snap;
    const r = decidirCiclo({
      estado: ESTADO_CICLO_INICIAL,
      snapshot: sinPh,
      mapeo,
      ahora: T(0),
      sinDatosS: 60,
    });
    expect(r.tipo === "muestra" && r.muestra.v).toEqual({});
  });

  it("retomar desde el estado guardado no duplica la última muestra", () => {
    // Estado reconstruido de nodos.ultimo tras reiniciar el servidor.
    const guardado: EstadoCiclo = { seq: 42, sesion: 0, ultimoCambio: T(0), sinDatos: false };
    expect(ciclo(guardado, foto(42), 5).tipo).toBe("sin_cambio");
    expect(ciclo(guardado, foto(43), 5).tipo).toBe("muestra");
  });
});
