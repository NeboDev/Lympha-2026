import { describe, expect, it } from "vitest";
import type { Redis } from "../../platform/valkey.ts";
import { crearSeguimientoSeq } from "./seq.ts";

/** Valkey mínimo en memoria: getset y expire. */
function valkeyFalso() {
  const datos = new Map<string, string>();
  return {
    getset: async (k: string, v: string) => {
      const previo = datos.get(k) ?? null;
      datos.set(k, v);
      return previo;
    },
    expire: async () => 1,
  } as unknown as Redis;
}

describe("seguimiento de seq", () => {
  it("cuenta las lecturas que faltan entre dos seq consecutivos", async () => {
    const seguir = crearSeguimientoSeq(valkeyFalso());
    expect(await seguir("n", 0)).toBe(0); // primera
    expect(await seguir("n", 1)).toBe(0);
    expect(await seguir("n", 5)).toBe(3); // faltan 2, 3 y 4
  });

  it("un seq menor o igual (reinicio del nodo o reentrega) no es un hueco", async () => {
    const seguir = crearSeguimientoSeq(valkeyFalso());
    await seguir("n", 100);
    expect(await seguir("n", 100)).toBe(0);
    expect(await seguir("n", 3)).toBe(0);
    expect(await seguir("n", 4)).toBe(0);
  });

  it("lleva la cuenta por nodo", async () => {
    const seguir = crearSeguimientoSeq(valkeyFalso());
    await seguir("a", 10);
    expect(await seguir("b", 50)).toBe(0);
    expect(await seguir("a", 12)).toBe(1);
  });
});
