import { topico } from "@lympha/contracts";
import { describe, expect, it, vi } from "vitest";
import { crearLogger } from "../../platform/logger.ts";
import type { MetaNodo, ResolvedorNodo } from "../dispositivos/index.ts";
import { CODIGO_PUBACK, crearIngesta } from "./ingesta.ts";
import type { EventoNodo, TrabajoLecturas } from "./schema.ts";

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

function preparar(
  m: MetaNodo | null,
  extra: { seguirSeq?: (n: string, s: number) => Promise<number> } = {},
) {
  const encolados: TrabajoLecturas[] = [];
  const eventos: EventoNodo[] = [];
  const rechazos: string[] = [];
  let huecos = 0;
  const resolver: ResolvedorNodo = { resolver: async () => m, invalidar: async () => undefined };
  const ingesta = crearIngesta({
    resolver,
    encolar: async (t) => {
      encolados.push(t);
    },
    encolarEvento: async (e) => {
      eventos.push(e);
    },
    metricas: {
      recibida: () => undefined,
      rechazada: (motivo) => rechazos.push(motivo),
      huecos: (n) => {
        huecos += n;
      },
    },
    ...extra,
    log: crearLogger("prueba", "silent"),
    ahora: () => AHORA,
  });
  return { ingesta, encolados, eventos, rechazos, huecos: () => huecos };
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

  it("rechaza tópicos que el ingest no atiende", async () => {
    const { ingesta, rechazos } = preparar(meta());
    expect(await ingesta.manejar(topico(NODO, "config"), msg())).toBe(CODIGO_PUBACK.topicoInvalido);
    expect(await ingesta.manejar("otro/topico", msg())).toBe(CODIGO_PUBACK.topicoInvalido);
    expect(rechazos).toEqual(["topico_invalido", "topico_invalido"]);
  });

  it("cuenta cada rechazo por motivo", async () => {
    const { ingesta, rechazos } = preparar(meta());
    await ingesta.manejar(topico(NODO, "telemetry"), Buffer.from("x"));
    await ingesta.manejar(topico(NODO, "telemetry"), msg({ extra: 1 }));
    await ingesta.manejar(topico(NODO, "telemetry"), msg({ ts: TS + 3600 }));
    expect(rechazos).toEqual(["json_ilegible", "payload_invalido", "reloj_fuera_de_rango"]);
    const sin = preparar(null);
    await sin.ingesta.manejar(topico(NODO, "telemetry"), msg());
    expect(sin.rechazos).toEqual(["nodo_no_autorizado"]);
  });

  it("cuenta las lecturas perdidas que reporta el seguimiento de seq", async () => {
    const { ingesta, huecos } = preparar(meta(), { seguirSeq: async () => 3 });
    await ingesta.manejar(topico(NODO, "telemetry"), msg());
    expect(huecos()).toBe(3);
  });

  it("un fallo del seguimiento de seq no pierde la lectura", async () => {
    const { ingesta, encolados } = preparar(meta(), {
      seguirSeq: async () => {
        throw new Error("valkey");
      },
    });
    expect(await ingesta.manejar(topico(NODO, "telemetry"), msg())).toBe(CODIGO_PUBACK.ok);
    expect(encolados).toHaveLength(1);
  });

  describe("status (Last Will) y attributes", () => {
    it.each(["online", "offline"] as const)(
      "encola el estado %s con el espacio del nodo",
      async (estado) => {
        const { ingesta, eventos } = preparar(meta());
        expect(await ingesta.manejar(topico(NODO, "status"), Buffer.from(estado))).toBe(
          CODIGO_PUBACK.ok,
        );
        expect(eventos).toEqual([
          { tipo: "estado", nodoId: NODO, espacioId: ESPACIO, estado, recibidoEn: AHORA },
        ]);
      },
    );

    it("rechaza un estado desconocido y los de nodos sin espacio", async () => {
      const { ingesta, eventos } = preparar(meta());
      expect(await ingesta.manejar(topico(NODO, "status"), Buffer.from("dormido"))).toBe(
        CODIGO_PUBACK.payloadInvalido,
      );
      const libre = preparar(meta({ espacioId: null, estado: "desvinculado" }));
      expect(await libre.ingesta.manejar(topico(NODO, "status"), Buffer.from("online"))).toBe(
        CODIGO_PUBACK.nodoNoAutorizado,
      );
      expect(eventos).toHaveLength(0);
      expect(libre.eventos).toHaveLength(0);
    });

    it("encola los atributos (versión de firmware) y rechaza los inválidos", async () => {
      const { ingesta, eventos } = preparar(meta());
      const ok = Buffer.from(JSON.stringify({ v: 1, fw: "1.2.3", rssi: -60 }));
      expect(await ingesta.manejar(topico(NODO, "attributes"), ok)).toBe(CODIGO_PUBACK.ok);
      expect(eventos).toEqual([
        { tipo: "atributos", nodoId: NODO, espacioId: ESPACIO, fw: "1.2.3", recibidoEn: AHORA },
      ]);
      const malo = Buffer.from(JSON.stringify({ v: 1, fw: "1", extra: true }));
      expect(await ingesta.manejar(topico(NODO, "attributes"), malo)).toBe(
        CODIGO_PUBACK.payloadInvalido,
      );
    });
  });

  it("propaga los fallos de la cola para que ingest reintente sin confirmar", async () => {
    const ingesta = crearIngesta({
      resolver: { resolver: async () => meta(), invalidar: async () => undefined },
      encolar: vi.fn().mockRejectedValue(new Error("valkey caído")),
      encolarEvento: vi.fn().mockRejectedValue(new Error("valkey caído")),
      log: crearLogger("prueba", "silent"),
      ahora: () => AHORA,
    });
    await expect(ingesta.manejar(topico(NODO, "telemetry"), msg())).rejects.toThrow("valkey caído");
  });
});
