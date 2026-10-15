import { describe, expect, it } from "vitest";
import { RUTAS_CUBIERTAS } from "../../test/rutas-cubiertas.ts";
import { crearServidorHttp } from "../platform/http.ts";
import { crearLogger } from "../platform/logger.ts";
import { registrarRutas } from "./api.ts";

/** Enumera las rutas realmente registradas, sin conectar a nada. */
async function rutasRegistradas(
  appEnv: "local" | "staging" | "production",
  conWebhookTelegram = false,
): Promise<string[]> {
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
    {
      bd: falso,
      valkey: falso,
      mqtt: falso,
      version: "prueba",
      appEnv,
      verificador: falso,
      claimPepper: "pepper",
      ...(conWebhookTelegram
        ? { telegram: { secreto: "s".repeat(24), manejar: async () => undefined } }
        : {}),
    },
    log,
  );
  await app.ready();
  await app.close();
  return [...rutas].sort();
}

/** Todas las rutas que existen en alguna configuración posible. */
async function todasLasRutas(): Promise<string[]> {
  const conjuntos = await Promise.all([
    rutasRegistradas("local"),
    rutasRegistradas("local", true),
    rutasRegistradas("staging", true),
    rutasRegistradas("production", true),
  ]);
  return [...new Set(conjuntos.flat())].sort();
}

describe("cobertura de aislamiento de las rutas", () => {
  // La primera prueba carga todos los módulos de la API: en frío (transformación de TypeScript) puede pasar de los
  // 5 s por omisión y fallar sin que nada esté mal.
  it("toda ruta registrada está declarada pública o con su prueba de acceso cruzado", async () => {
    const sinCobertura = (await todasLasRutas()).filter((r) => !(r in RUTAS_CUBIERTAS));
    expect(
      sinCobertura,
      "Rutas sin prueba de aislamiento: agrégalas a test/rutas-cubiertas.ts con su prueba (RNF-01)",
    ).toEqual([]);
  }, 30_000);

  it("no queda ninguna entrada obsoleta en el registro", async () => {
    const reales = new Set(await todasLasRutas());
    expect(Object.keys(RUTAS_CUBIERTAS).filter((r) => !reales.has(r))).toEqual([]);
  });

  it("no existen rutas de desarrollo (/dev/*) en ningún entorno", async () => {
    expect((await todasLasRutas()).filter((r) => r.includes("/dev/"))).toEqual([]);
  });

  it("el webhook de Telegram solo existe si Telegram está en modo webhook", async () => {
    expect(await rutasRegistradas("local")).not.toContain("POST /telegram/webhook");
    expect(await rutasRegistradas("production", true)).toContain("POST /telegram/webhook");
  });

  it("toda ruta con datos de usuario vive bajo /api (salvo las declaradas públicas)", async () => {
    for (const [ruta, cobertura] of Object.entries(RUTAS_CUBIERTAS)) {
      if (cobertura !== "publica") expect(ruta.split(" ")[1]).toMatch(/^\/api\//);
    }
  });
});
