import { preferenciaBody } from "@lympha/contracts";
import { describe, expect, it } from "vitest";
import { aBorrador, dePreferencia, resumenPreferencia } from "./preferencias.ts";

const NODO = "0192f3a7-0000-7000-8000-00000000e001";
const BASE = {
  nodo_id: null,
  niveles: ["mala", "critica"] as ("mala" | "critica" | "regular")[],
  silencio_inicio: null,
  silencio_fin: null,
  zona_horaria: "America/Mexico_City",
  recordatorio_h: 6,
};

describe("preferencias", () => {
  it("ir y volver del borrador no cambia nada", () => {
    for (const p of [BASE, { ...BASE, silencio_inicio: "21:30", silencio_fin: "06:45" }]) {
      const r = dePreferencia(aBorrador(p), null);
      expect(r).toEqual({ ok: true, preferencia: p });
    }
  });

  it("lo que arma el formulario siempre lo acepta el contrato de la API", () => {
    const r = dePreferencia(
      { ...aBorrador(BASE), silencioActivo: true, silencioInicio: "22:00", silencioFin: "07:00" },
      NODO,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(preferenciaBody.safeParse(r.preferencia).success).toBe(true);
    if (r.ok) expect(r.preferencia.nodo_id).toBe(NODO);
  });

  it("sin horario silencioso manda inicio y fin nulos (la API exige las dos o ninguna)", () => {
    const r = dePreferencia({ ...aBorrador(BASE), silencioActivo: false }, null);
    expect(r).toMatchObject({
      ok: true,
      preferencia: { silencio_inicio: null, silencio_fin: null },
    });
  });

  it("un horario con inicio igual al fin, o sin horas, se rechaza con un mensaje", () => {
    const b = { ...aBorrador(BASE), silencioActivo: true };
    expect(dePreferencia({ ...b, silencioInicio: "08:00", silencioFin: "08:00" }, null).ok).toBe(
      false,
    );
    expect(dePreferencia({ ...b, silencioInicio: "", silencioFin: "07:00" }, null).ok).toBe(false);
    expect(dePreferencia({ ...b, silencioInicio: "25:00", silencioFin: "07:00" }, null).ok).toBe(
      false,
    );
  });

  it("el recordatorio debe ser un entero de 1 a 72 horas", () => {
    for (const malo of ["0", "73", "1.5", "", "abc", "-3"]) {
      expect(dePreferencia({ ...aBorrador(BASE), recordatorioH: malo }, null).ok).toBe(false);
    }
    expect(dePreferencia({ ...aBorrador(BASE), recordatorioH: "72" }, null).ok).toBe(true);
  });

  it("elegir ningún nivel es válido (solo avisan las alarmas de conexión y de sensor)", () => {
    const r = dePreferencia({ ...aBorrador(BASE), niveles: [] }, null);
    expect(r).toMatchObject({ ok: true, preferencia: { niveles: [] } });
  });

  it("los niveles salen siempre en el orden regular, mala, crítica y sin repetir", () => {
    const r = dePreferencia({ ...aBorrador(BASE), niveles: ["critica", "regular", "mala"] }, null);
    expect(r).toMatchObject({ ok: true, preferencia: { niveles: ["regular", "mala", "critica"] } });
  });

  it("el resumen se lee como una frase corta", () => {
    expect(resumenPreferencia(BASE)).toBe(
      "Mala y crítica · sin horario silencioso · recordatorio cada 6 h",
    );
    expect(
      resumenPreferencia({ ...BASE, niveles: [], silencio_inicio: "22:00", silencio_fin: "07:00" }),
    ).toBe("Sin avisos de calidad · silencio 22:00–07:00 · recordatorio cada 6 h");
    expect(resumenPreferencia({ ...BASE, niveles: ["critica"] })).toMatch(/^Crítica · /);
    expect(resumenPreferencia({ ...BASE, niveles: ["regular", "mala", "critica"] })).toMatch(
      /^Regular, mala y crítica · /,
    );
  });
});
