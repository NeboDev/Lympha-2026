import { describe, expect, it } from "vitest";
import { archivosDelLote, reglaPagina, svgComoUrl } from "./entrega.ts";

const lote = {
  loteId: "0192f3a7-0000-7000-8000-0000000000f1",
  creadoEn: "2026-10-28T12:00:00.000Z",
  versionHw: "v1",
  etiquetas: [
    {
      device_id: "0192f3a7-0000-7000-8000-0000000d00a1",
      lote_id: "0192f3a7-0000-7000-8000-0000000000f1",
      codigo_reclamo: "ABCD-2345-EFGH",
      ap_key: "KKKKKKKKKK",
      red_ap: "Lympha-00a1",
      mqtt_password: "contrasena-mqtt",
      svg: "<svg/>",
    },
  ],
};

describe("archivos del lote", () => {
  it("el manifiesto no lleva secretos y las identidades sí (mismo formato que el CLI)", () => {
    const [manifiesto, identidades, etiqueta] = archivosDelLote(lote);
    expect(String(manifiesto?.contenido)).not.toMatch(/ABCD|KKKK|contrasena/);
    const ident = JSON.parse(String(identidades?.contenido));
    expect(ident.nodos[0]).toEqual({
      deviceId: lote.etiquetas[0]?.device_id,
      mqttPassword: "contrasena-mqtt",
      apKey: "KKKKKKKKKK",
      codigoReclamo: "ABCD-2345-EFGH",
    });
    expect(etiqueta?.nombre).toBe(`etiquetas/${lote.etiquetas[0]?.device_id}.svg`);
  });
});

describe("impresión", () => {
  it("la hoja usa A4 y el rollo, el tamaño exacto de la etiqueta", () => {
    expect(reglaPagina("hoja")).toContain("A4");
    expect(reglaPagina("rollo")).toContain("80mm 44mm");
  });

  it("el SVG se muestra como imagen data: (sin ejecutar nada)", () => {
    expect(svgComoUrl("<svg a='1'/>")).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  });
});
