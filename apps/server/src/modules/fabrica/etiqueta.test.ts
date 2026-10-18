import { describe, expect, it } from "vitest";
import { etiquetaSvg, nombreAp, textoQrReclamo, textoQrWifi } from "./etiqueta.ts";

const ID = "0192f3a7-5d1c-7a2b-8c3d-0123456789ab";
const datos = {
  deviceId: ID,
  codigoReclamo: "ABCD2345EFGH",
  loteId: "L1",
  versionHw: "v1",
  apKey: "ABCD234EFG",
};

describe("etiqueta", () => {
  it("el QR de reclamo usa el formato que lee la PWA", () => {
    expect(textoQrReclamo(ID, "ABCD2345EFGH")).toBe(`lympha://reclamar?n=${ID}&c=ABCD-2345-EFGH`);
    expect(textoQrReclamo(ID, "ABCD-2345-EFGH")).toBe(`lympha://reclamar?n=${ID}&c=ABCD-2345-EFGH`);
  });

  // Estos valores son los mismos que comprueba test/host/test_portal.c en lympha-firmware: si cambian aquí o allá,
  // el teléfono no encontraría el AP que anuncia la etiqueta.
  it("el nombre del AP y el QR de WiFi coinciden con los del firmware", () => {
    expect(nombreAp("0192F3A7-5D1C-7A2B-8C3D-0123456789AB")).toBe("Lympha-89ab");
    expect(textoQrWifi("Lympha-89ab", "ABCD234EFG")).toBe(
      "WIFI:T:WPA;S:Lympha-89ab;P:ABCD234EFG;;",
    );
    expect(textoQrWifi("a;b:c", 'p\\q,"r')).toBe('WIFI:T:WPA;S:a\\;b\\:c;P:p\\\\q\\,\\"r;;');
  });

  it("dibuja dos QR, la red con su clave y el código, sin afirmar nada del agua", () => {
    const svg = etiquetaSvg(datos);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.match(/<g fill="#000">/g)).toHaveLength(2);
    expect(svg).toContain("ABCD-2345-EFGH");
    expect(svg).toContain(ID);
    expect(svg).toContain("Red Lympha-89ab");
    expect(svg).toContain("Clave ABCD234EFG");
    expect(svg.toLowerCase()).not.toMatch(/potable|seguro/);
  });

  it("escapa el texto de la etiqueta", () => {
    const svg = etiquetaSvg({ ...datos, loteId: "<L>", apKey: "<&>" });
    expect(svg).not.toContain("<L>");
    expect(svg).not.toContain("<&>");
  });
});
