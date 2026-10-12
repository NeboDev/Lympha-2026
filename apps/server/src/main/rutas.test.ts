import { describe, expect, it } from "vitest";
import { RUTAS_CUBIERTAS } from "../../test/rutas-cubiertas.ts";
import { crearServidorHttp } from "../platform/http.ts";
import { crearLogger } from "../platform/logger.ts";
import { registrarRutas } from "./api.ts";

/** Enumera las rutas registradas con el entorno indicado, sin conectar a nada. */
async function rutasRegistradas(appEnv: "local" | "staging" | "production"): Promise<string[]> {
  const log = crearLogger("prueba", "silent");
  const app = crearServidorHttp(log);
  const rutas = new Set<string>();
  app.addHook("onRoute", (r) => {
    for (const metodo of [r.method].flat()) {
      if (metodo !== "HEAD" && metodo !== "OPTIONS") rutas.add(`${metodo} ${r.url}`);
    }
  });
  const falso = {} as never;
  await registrarRutas(
    app,
    { bd: falso, valkey: falso, mqtt: falso, version: "prueba", appEnv },
    log,
  );
  await app.ready();
  await app.close();
  return [...rutas].sort();
}

describe("cobertura de aislamiento de las rutas", () => {
  it("toda ruta registrada está declarada pública o con su prueba de acceso cruzado", async () => {
    const sinCobertura = (await rutasRegistradas("local")).filter((r) => !(r in RUTAS_CUBIERTAS));
    expect(
      sinCobertura,
      `Rutas sin prueba de aislamiento: agrégalas a test/rutas-cubiertas.ts con su prueba (RNF-01)`,
    ).toEqual([]);
  });

  it("no queda ninguna entrada obsoleta en el registro", async () => {
    const reales = new Set(await rutasRegistradas("local"));
    expect(Object.keys(RUTAS_CUBIERTAS).filter((r) => !reales.has(r))).toEqual([]);
  });

  it("las rutas /dev/* no existen fuera de APP_ENV=local", async () => {
    for (const entorno of ["staging", "production"] as const) {
      const rutas = await rutasRegistradas(entorno);
      expect(rutas.filter((r) => r.includes("/dev/"))).toEqual([]);
    }
  });
});
