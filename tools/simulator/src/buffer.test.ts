import { describe, expect, it } from "vitest";
import { BufferLecturas, capacidadParaHoras } from "./buffer.ts";

const lectura = (seq: number) => ({ ts: 1760150400 + seq * 60, seq, ph: 7 });
const sinEspera = async () => undefined;

describe("capacidadParaHoras", () => {
  it("24 h a una lectura por minuto son 1,440 lecturas", () => {
    expect(capacidadParaHoras(24, 60)).toBe(1440);
    expect(capacidadParaHoras(24, 5)).toBe(17_280);
  });
});

describe("BufferLecturas", () => {
  it("guarda 24 h de lecturas y las devuelve en orden con su ts y seq originales", async () => {
    const b = new BufferLecturas(capacidadParaHoras(24, 60));
    for (let i = 0; i < 1440; i++) b.agregar(lectura(i));
    expect(b.tamano).toBe(1440);
    expect(b.descartadas).toBe(0);

    const salidas: number[] = [];
    const n = await b.vaciar(async (l) => void salidas.push(l.seq), {
      porSegundo: 1000,
      esperar: sinEspera,
    });
    expect(n).toBe(1440);
    expect(salidas).toEqual(Array.from({ length: 1440 }, (_, i) => i));
    expect(b.tamano).toBe(0);
  });

  it("al llenarse descarta lo más viejo y lo cuenta", () => {
    const b = new BufferLecturas(3);
    for (let i = 0; i < 5; i++) b.agregar(lectura(i));
    expect(b.tamano).toBe(3);
    expect(b.descartadas).toBe(2);
  });

  it("si la publicación falla conserva la lectura y se detiene", async () => {
    const b = new BufferLecturas(10);
    for (let i = 0; i < 4; i++) b.agregar(lectura(i));
    const salidas: number[] = [];
    const n = await b.vaciar(
      async (l) => {
        if (l.seq === 2) throw new Error("conexión caída");
        salidas.push(l.seq);
      },
      { porSegundo: 1000, esperar: sinEspera },
    );
    expect(n).toBe(2);
    expect(salidas).toEqual([0, 1]);
    expect(b.tamano).toBe(2);
    // al reintentar, sigue desde la que falló
    const despues: number[] = [];
    await b.vaciar(async (l) => void despues.push(l.seq), { porSegundo: 1000, esperar: sinEspera });
    expect(despues).toEqual([2, 3]);
  });

  it("respeta el ritmo y se detiene si la conexión deja de ser vigente", async () => {
    const b = new BufferLecturas(10);
    for (let i = 0; i < 5; i++) b.agregar(lectura(i));
    const pausas: number[] = [];
    let vigente = true;
    const n = await b.vaciar(
      async (l) => {
        if (l.seq === 1) vigente = false;
      },
      {
        porSegundo: 10,
        esperar: async (ms) => void pausas.push(ms),
        vigente: () => vigente,
      },
    );
    expect(n).toBe(2);
    expect(pausas).toEqual([100, 100]);
    expect(b.tamano).toBe(3);
  });

  it("una lectura que llega durante el vaciado queda detrás de las guardadas", async () => {
    const b = new BufferLecturas(10);
    b.agregar(lectura(0));
    b.agregar(lectura(1));
    const salidas: number[] = [];
    await b.vaciar(
      async (l) => {
        if (l.seq === 0) b.agregar(lectura(2));
        salidas.push(l.seq);
      },
      { porSegundo: 1000, esperar: sinEspera },
    );
    expect(salidas).toEqual([0, 1, 2]);
  });
});
