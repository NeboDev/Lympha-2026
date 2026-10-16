import { describe, expect, it } from "vitest";
import {
  type ComandoOta,
  cohorte,
  evaluarEtapa,
  type NodoOta,
  nodoSano,
  VENTANA_NODO_MS,
} from "./despliegue.ts";
import { type DepsOrquestador, desplegar } from "./orquestador.ts";

const T0 = new Date("2026-10-16T12:00:00Z");
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

function nodo(
  id: string,
  extra: Partial<Omit<NodoOta, "comando">> & { comando?: Partial<ComandoOta> | null } = {},
) {
  const { comando, ...resto } = extra;
  return {
    nodoId: id,
    versionFw: "1.0.0",
    conectado: true,
    ultimaLecturaEn: null,
    comando:
      comando === null
        ? null
        : { estado: "enviado", detalle: null, enviadoEn: T0, respondidoEn: null, ...comando },
    ...resto,
  } as NodoOta;
}
const sano = (id: string) =>
  nodo(id, {
    versionFw: "1.1.0",
    ultimaLecturaEn: min(3),
    comando: { estado: "ok", respondidoEn: min(1) },
  });

describe("cohorte", () => {
  const ids = Array.from({ length: 40 }, (_, i) => `n${String(i).padStart(2, "0")}`);

  it("toma el porcentaje en orden, al menos uno, y es acumulada", () => {
    expect(cohorte(ids, 5)).toEqual(["n00", "n01"]);
    expect(cohorte(ids, 25)).toHaveLength(10);
    expect(cohorte(ids, 25).slice(0, 2)).toEqual(cohorte(ids, 5));
    expect(cohorte(ids, 100)).toEqual(ids);
    expect(cohorte(["solo"], 5)).toEqual(["solo"]);
    expect(cohorte([], 5)).toEqual([]);
  });

  it("no depende del orden de entrada", () => {
    expect(cohorte([...ids].reverse(), 5)).toEqual(cohorte(ids, 5));
  });
});

describe("evaluarEtapa", () => {
  it("completa cuando todos volvieron sanos", () => {
    expect(evaluarEtapa([sano("a"), sano("b")], "1.1.0", min(5))).toEqual({ tipo: "completa" });
  });

  it("espera mientras la ventana no se agota", () => {
    const v = evaluarEtapa([sano("a"), nodo("b")], "1.1.0", min(5));
    expect(v).toEqual({ tipo: "esperando", pendientes: 1 });
  });

  it("falla si un nodo rechazó el comando", () => {
    const v = evaluarEtapa(
      [sano("a"), nodo("b", { comando: { estado: "error", detalle: "sha256 distinto" } })],
      "1.1.0",
      min(1),
    );
    expect(v).toMatchObject({ tipo: "falla" });
    expect((v as { motivo: string }).motivo).toContain("sha256 distinto");
  });

  it("falla si un nodo no volvió dentro de la ventana", () => {
    const ventana = VENTANA_NODO_MS / 60_000;
    expect(evaluarEtapa([nodo("b")], "1.1.0", min(ventana + 1))).toMatchObject({ tipo: "falla" });
    expect(evaluarEtapa([nodo("b")], "1.1.0", min(ventana - 1))).toMatchObject({
      tipo: "esperando",
    });
  });

  it("un nodo con la versión nueva pero sin lecturas posteriores o desconectado no es sano", () => {
    expect(nodoSano({ ...sano("a"), ultimaLecturaEn: min(1) }, "1.1.0")).toBe(false);
    expect(nodoSano({ ...sano("a"), ultimaLecturaEn: null }, "1.1.0")).toBe(false);
    expect(nodoSano({ ...sano("a"), conectado: false }, "1.1.0")).toBe(false);
    expect(nodoSano({ ...sano("a"), versionFw: "1.0.0" }, "1.1.0")).toBe(false);
    expect(nodoSano(sano("a"), "1.1.0")).toBe(true);
  });
});

function depsFalsas(opciones: { falla?: string[]; ids: string[] }) {
  let ahora = T0.getTime();
  const enviados: { etapa: number; nodoId: string }[] = [];
  const respondidos = new Set<string>();
  const cerrado: { estado?: string; motivo?: string } = {};
  let etapaActual = 0;
  const deps: DepsOrquestador = {
    elegibles: async () => opciones.ids,
    crearDespliegue: async () => "d1",
    cambiarEtapa: async (_id, etapa) => {
      etapaActual = etapa;
    },
    cerrar: async (_id, estado, motivo) => {
      cerrado.estado = estado;
      cerrado.motivo = motivo;
    },
    enviar: async (_id, nodoId) => {
      enviados.push({ etapa: etapaActual, nodoId });
      respondidos.add(nodoId);
    },
    estados: async (_id, ids) =>
      ids.map((id) => {
        if (opciones.falla?.includes(id)) return nodo(id);
        return respondidos.has(id)
          ? {
              ...sano(id),
              comando: { ...sano(id).comando, enviadoEn: new Date(ahora) } as ComandoOta,
            }
          : nodo(id);
      }),
    detenido: async () => false,
    ahora: () => new Date(ahora),
    dormir: async (ms) => {
      ahora += ms;
    },
    aviso: () => undefined,
  };
  return { deps, enviados, cerrado };
}

describe("desplegar", () => {
  const ids = Array.from({ length: 20 }, (_, i) => `n${String(i).padStart(2, "0")}`);

  it("avanza 5 % → 25 % → 100 % y manda el comando una sola vez por nodo", async () => {
    const { deps, enviados, cerrado } = depsFalsas({ ids });
    const r = await desplegar(deps, "1.1.0", { sondeoMs: 1000 });
    expect(r).toMatchObject({ estado: "completado", etapa: 100, actualizados: 20 });
    expect(cerrado.estado).toBe("completado");
    expect(enviados).toHaveLength(20);
    expect(new Set(enviados.map((e) => e.nodoId)).size).toBe(20);
    expect(enviados.filter((e) => e.etapa === 5)).toHaveLength(1);
    expect(enviados.filter((e) => e.etapa === 25)).toHaveLength(4);
  });

  it("se detiene en la primera falla sin tocar al resto de la flota", async () => {
    const { deps, enviados, cerrado } = depsFalsas({ ids, falla: ["n00"] });
    const r = await desplegar(deps, "1.1.0", { sondeoMs: 60_000, ventanaMs: 5 * 60_000 });
    expect(r.estado).toBe("detenido");
    expect(r.etapa).toBe(5);
    expect(r.motivo).toContain("n00");
    expect(cerrado.estado).toBe("detenido");
    expect(enviados).toHaveLength(1);
  });

  it("no empieza sin nodos elegibles", async () => {
    const { deps } = depsFalsas({ ids: [] });
    await expect(desplegar(deps, "1.1.0")).rejects.toThrow(/no hay nodos/);
  });
});
