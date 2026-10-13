import { describe, expect, it } from "vitest";
import { crearRegistro, servirMetricas } from "./metricas.ts";

describe("métricas (prom-client)", () => {
  it("expone contadores con etiquetas en el formato de Prometheus", async () => {
    const r = crearRegistro({ porDefecto: false });
    const c = r.contador("lympha_lecturas_rechazadas_total", "Rechazos por motivo", ["motivo"]);
    c.inc({ motivo: "payload_invalido" });
    c.inc({ motivo: "payload_invalido" }, 2);
    c.inc({ motivo: "json_ilegible" });
    const t = await r.texto();
    expect(t).toContain("# TYPE lympha_lecturas_rechazadas_total counter");
    expect(t).toContain('lympha_lecturas_rechazadas_total{motivo="payload_invalido"} 3');
    expect(t).toContain('lympha_lecturas_rechazadas_total{motivo="json_ilegible"} 1');
  });

  it("un contador sin etiquetas aparece en 0 desde el arranque", async () => {
    const r = crearRegistro({ porDefecto: false });
    r.contador("lympha_x_total", "x");
    expect(await r.texto()).toContain("lympha_x_total 0");
  });

  it("un medidor se lee al consultar y uno que falla no rompe la página", async () => {
    const r = crearRegistro({ porDefecto: false });
    r.medidor("lympha_ok", "ok", () => 5);
    r.medidor("lympha_roto", "roto", () => {
      throw new Error("no");
    });
    expect(await r.texto()).toContain("lympha_ok 5");
  });

  it("incluye las métricas por defecto del proceso", async () => {
    const t = await crearRegistro().texto();
    expect(t).toContain("process_cpu_user_seconds_total");
    expect(t).toContain("nodejs_eventloop_lag_seconds");
    expect(t).toContain("process_resident_memory_bytes");
  });

  it("sirve GET /metrics y nada más", async () => {
    const r = crearRegistro({ porDefecto: false });
    r.contador("lympha_z_total", "z").inc();
    const s = await servirMetricas(r, 0);
    try {
      const puerto = (s.address() as { port: number }).port;
      const ok = await fetch(`http://127.0.0.1:${puerto}/metrics`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("content-type")).toContain("text/plain");
      expect(await ok.text()).toContain("lympha_z_total 1");
      expect((await fetch(`http://127.0.0.1:${puerto}/otra`)).status).toBe(404);
    } finally {
      s.close();
    }
  });
});
