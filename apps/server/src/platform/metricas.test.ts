import { describe, expect, it } from "vitest";
import { crearRegistro, servirMetricas } from "./metricas.ts";

describe("métricas", () => {
  it("expone contadores con etiquetas en el formato de Prometheus", async () => {
    const r = crearRegistro();
    const c = r.contador("lympha_lecturas_rechazadas_total", "Rechazos por motivo");
    c.inc({ motivo: "payload_invalido" });
    c.inc({ motivo: "payload_invalido" }, 2);
    c.inc({ motivo: "json_ilegible" });
    const t = await r.texto();
    expect(t).toContain("# TYPE lympha_lecturas_rechazadas_total counter");
    expect(t).toContain('lympha_lecturas_rechazadas_total{motivo="payload_invalido"} 3');
    expect(t).toContain('lympha_lecturas_rechazadas_total{motivo="json_ilegible"} 1');
    expect(c.valor({ motivo: "payload_invalido" })).toBe(3);
  });

  it("un contador sin datos aparece en 0 y un medidor que falla no rompe la página", async () => {
    const r = crearRegistro();
    r.contador("lympha_x_total", "x");
    r.medidor("lympha_ok", "ok", () => 5);
    r.medidor("lympha_roto", "roto", () => {
      throw new Error("no");
    });
    const t = await r.texto();
    expect(t).toContain("lympha_x_total 0");
    expect(t).toContain("lympha_ok 5");
  });

  it("las etiquetas no pueden inyectar líneas ni comillas", async () => {
    const r = crearRegistro();
    r.contador("lympha_y_total", "y").inc({ motivo: 'a"b\nc' });
    expect(await r.texto()).toContain('lympha_y_total{motivo="a_b_c"} 1');
  });

  it("sirve GET /metrics y nada más", async () => {
    const r = crearRegistro();
    r.contador("lympha_z_total", "z").inc();
    const s = await servirMetricas(r, 0);
    try {
      const puerto = (s.address() as { port: number }).port;
      const ok = await fetch(`http://127.0.0.1:${puerto}/metrics`);
      expect(ok.status).toBe(200);
      expect(await ok.text()).toContain("lympha_z_total 1");
      expect((await fetch(`http://127.0.0.1:${puerto}/otra`)).status).toBe(404);
    } finally {
      s.close();
    }
  });
});
