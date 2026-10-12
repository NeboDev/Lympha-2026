import { describe, expect, it } from "vitest";
import { ordenarLecturas } from "./guardar.ts";
import type { LecturaTrabajo } from "./schema.ts";

const base = {
  espacioId: "0192f3a7-5d1c-7a2b-8c3d-0123456789ac",
  ph: null,
  temperatura: null,
  conductividad: null,
  turbidez: null,
  tds: null,
  recibidoEn: 1,
};
const A = "0192f3a7-0000-7000-8000-00000000000a";
const B = "0192f3a7-0000-7000-8000-00000000000b";
const l = (nodoId: string, ts: number, seq: number): LecturaTrabajo => ({
  ...base,
  nodoId,
  ts,
  seq,
});

describe("ordenarLecturas", () => {
  it("ordena por nodo y, dentro de cada nodo, por ts y luego seq", () => {
    const r = ordenarLecturas([l(B, 5, 1), l(A, 9, 2), l(A, 3, 4), l(B, 1, 0), l(A, 3, 3)]);
    expect(r.map((x) => `${x.nodoId.slice(-1)}${x.ts}/${x.seq}`)).toEqual([
      "a3/3",
      "a3/4",
      "a9/2",
      "b1/0",
      "b5/1",
    ]);
  });

  it("no modifica el arreglo recibido", () => {
    const entrada = [l(B, 2, 1), l(A, 1, 0)];
    ordenarLecturas(entrada);
    expect(entrada[0]?.nodoId).toBe(B);
  });
});
