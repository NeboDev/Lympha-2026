import { describe, expect, it } from "vitest";
import type { NombreEscenario } from "../../simulador/escenarios.ts";
import {
  BaseFalsa,
  catalogoDePrueba,
  lectorDeEscenario,
  nodoDePrueba,
  T0,
} from "../../test/falsos.ts";
import { type CambioNodo, crearIngesta } from "./index.ts";

function entorno(escenario: NombreEscenario, alCambio: (c: CambioNodo) => Promise<void>) {
  const base = new BaseFalsa();
  const nodo = base.agregarNodo(nodoDePrueba());
  let ahora = T0;
  const reloj = () => new Date(ahora);
  const ingesta = crearIngesta({
    almacen: base,
    lector: lectorDeEscenario(escenario, reloj),
    catalogo: catalogoDePrueba,
    sinDatosS: 60,
    alCambio,
    reloj,
  });
  return {
    base,
    nodo,
    async correr(hasta: number, desde = 0) {
      for (let t = desde; t <= hasta; t += 5) {
        ahora = T0 + t * 1000;
        await ingesta.ciclo(nodo);
      }
    },
  };
}

describe("gancho alCambio de la ingesta", () => {
  it("se llama una vez por muestra, después de guardarla, con la foto del nodo", async () => {
    const llamadas: { seq: number; muestrasGuardadas: number }[] = [];
    let e!: ReturnType<typeof entorno>;
    e = entorno("estable", async (c) => {
      llamadas.push({ seq: c.ultimo.seq, muestrasGuardadas: e.base.muestras.length });
      expect(c.nodo._id.equals(e.nodo._id)).toBe(true);
      expect(c.ultimo.estados).toEqual({ ph: "en_rango" });
    });
    await e.correr(20);
    expect(llamadas.map((l) => l.seq)).toEqual([1, 2, 3, 4, 5]);
    // Cuando se llama, la muestra ya está guardada.
    expect(llamadas.every((l, i) => l.muestrasGuardadas === i + 1)).toBe(true);
  });

  it("se llama cuando el nodo se da por detenido, con sin_datos = true, una sola vez", async () => {
    const fotos: boolean[] = [];
    const e = entorno("nodo_detenido", async (c) => {
      fotos.push(c.ultimo.sin_datos);
    });
    await e.correr(240); // detenido de 60 a 240 s
    const detenidas = fotos.filter((x) => x).length;
    expect(detenidas).toBe(1);
    // Al reconectarse, la nueva muestra llega con sin_datos = false.
    expect(fotos.at(-1)).toBe(false);
  });

  it("si falla, se reintenta en el siguiente ciclo sin perder muestras ni el orden", async () => {
    const vistos: number[] = [];
    let falla = true;
    const e = entorno("estable", async (c) => {
      if (falla && c.ultimo.seq === 3) {
        falla = false;
        throw new Error("alertas caídas");
      }
      vistos.push(c.ultimo.seq);
    });
    await e.correr(40);
    // La alerta del seq 3 se reintentó (y las posteriores esperaron), nada se perdió.
    expect(vistos).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(e.base.muestras.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("guarda el detalle de la evaluación (cambio rápido) en la muestra y en el nodo", async () => {
    const e = entorno("pico", async () => {});
    await e.correr(300);
    const conRapido = e.base.muestras.filter((m) => m.detalles.ph?.cambio_rapido);
    expect(conRapido.length).toBeGreaterThan(0);
    expect(conRapido[0]?.detalles.ph?.cambio).not.toBeNull();
    const ultimo = e.base.ultimos.get(e.nodo._id.toHexString());
    expect(ultimo?.detalles?.ph).toBeDefined();
  });

  it("sin gancho, la ingesta funciona igual", async () => {
    const base = new BaseFalsa();
    const nodo = base.agregarNodo(nodoDePrueba());
    const ahora = T0;
    const reloj = () => new Date(ahora);
    const ingesta = crearIngesta({
      almacen: base,
      lector: lectorDeEscenario("estable", reloj),
      catalogo: catalogoDePrueba,
      sinDatosS: 60,
      reloj,
    });
    await ingesta.ciclo(nodo);
    expect(base.muestras).toHaveLength(1);
  });
});
