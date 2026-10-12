import { topico } from "@lympha/contracts";
import { describe, expect, it, vi } from "vitest";
import { crearLogger } from "../../platform/logger.ts";
import type { MetaNodo, ResolvedorNodo } from "../dispositivos/index.ts";
import { CODIGO_PUBACK, crearIngesta } from "./ingesta.ts";
import type { TrabajoLecturas } from "./schema.ts";

const NODO = "0192f3a7-5d1c-7a2b-8c3d-0123456789ab";
const ESPACIO = "0192f3a7-5d1c-7a2b-8c3d-0123456789ac";
const AHORA = Date.parse("2026-10-11T12:00:00Z");
const TS = Math.floor(AHORA / 1000) - 30;

const meta = (extra: Partial<MetaNodo> = {}): MetaNodo => ({
  espacioId: ESPACIO,
  perfilId: "cisterna",
  perfilVersion: 1,
  estado: "activo",
  ...extra,
});

function preparar(m: MetaNodo | null) {
  const encolados: TrabajoLecturas[] = [];
  const resolver: ResolvedorNodo = { resolver: async () => m, invalidar: async () => undefined };
  const ingesta = crearIngesta({
    resolver,
    encolar: async (t) => {
      encolados.push(t);
    },
    log: crearLogger("prueba", "silent"),
    ahora: () => AHORA,
  });
  return { ingesta, encolados };
}

const msg = (o: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({ v: 1, ts: TS, seq: 7, ph: 7.1, t: 22.4, ec: 480, turb: 0.8, tds: 310, ...o }),
  );

describe("crearIngesta", () => {
  it("encola la lectura con el espacio del nodo y confirma con éxito", async () => {
    const { ingesta, encolados } = preparar(meta());
    expect(await ingesta.manejar(topico(NODO, "telemetry"), msg())).toBe(CODIGO_PUBACK.ok);
    expect(encolados).toHaveLength(1);
    expect(encolados[0]?.lecturas[0]).toMatchObject({
      nodoId: NODO,
      espacioId: ESPACIO,
      ts: TS * 1000,
      seq: 7,
      ph: 7.1,
      temperatura: 22.4,
      conductividad: 480,
      turbidez: 0.8,
      tds: 310,
      recibidoEn: AHORA,
    });
  });

  it("las mediciones ausentes quedan en null", async () => {
    const { ingesta, encolados } = preparar(meta());
    await ingesta.manejar(
      topico(NODO, "telemetry"),
      Buffer.from(JSON.stringify({ v: 1, ts: TS, seq: 1 })),
    );
    expect(encolados[0]?.lecturas[0]).toMatchObject({ ph: null, temperatura: null, tds: null });
  });

  it.each([
    ["JSON ilegible", Buffer.from("no es json"), CODIGO_PUBACK.payloadInvalido],
    ["campo desconocido", msg({ extra: 1 }), CODIGO_PUBACK.payloadInvalido],
    ["versión no soportada", msg({ v: 9 }), CODIGO_PUBACK.payloadInvalido],
    ["reloj adelantado", msg({ ts: TS + 3600 }), CODIGO_PUBACK.payloadInvalido],
    ["reloj de 1970", msg({ ts: 1000 }), CODIGO_PUBACK.payloadInvalido],
  ])("rechaza %s sin encolar", async (_nombre, carga, codigo) => {
    const { ingesta, encolados } = preparar(meta());
    expect(await ingesta.manejar(topico(NODO, "telemetry"), carga)).toBe(codigo);
    expect(encolados).toHaveLength(0);
  });

  it.each([
    ["nodo inexistente", null],
    ["nodo sin reclamar", meta({ espacioId: null, estado: "fabricado" })],
    ["nodo revocado", meta({ espacioId: null, estado: "revocado" })],
    ["nodo desvinculado", meta({ espacioId: null, estado: "desvinculado" })],
  ])("rechaza %s", async (_nombre, m) => {
    const { ingesta, encolados } = preparar(m);
    expect(await ingesta.manejar(topico(NODO, "telemetry"), msg())).toBe(
      CODIGO_PUBACK.nodoNoAutorizado,
    );
    expect(encolados).toHaveLength(0);
  });

  it("rechaza tópicos que no son de telemetría", async () => {
    const { ingesta } = preparar(meta());
    expect(await ingesta.manejar(topico(NODO, "attributes"), msg())).toBe(
      CODIGO_PUBACK.topicoInvalido,
    );
    expect(await ingesta.manejar("otro/topico", msg())).toBe(CODIGO_PUBACK.topicoInvalido);
  });

  it("propaga los fallos de la cola para que ingest reintente sin confirmar", async () => {
    const ingesta = crearIngesta({
      resolver: { resolver: async () => meta(), invalidar: async () => undefined },
      encolar: vi.fn().mockRejectedValue(new Error("valkey caído")),
      log: crearLogger("prueba", "silent"),
      ahora: () => AHORA,
    });
    await expect(ingesta.manejar(topico(NODO, "telemetry"), msg())).rejects.toThrow("valkey caído");
  });
});
