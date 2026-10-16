import { describe, expect, it } from "vitest";
import { etiquetaSvg, textoQrNodo, textoQrReclamo } from "./etiqueta.ts";

const ID = "0192f3a7-5d1c-7a2b-8c3d-0123456789ab";

describe("etiqueta", () => {
  it("el QR de reclamo usa el formato que lee la PWA", () => {
    expect(textoQrReclamo(ID, "ABCD2345EFGH")).toBe(`lympha://reclamar?n=${ID}&c=ABCD-2345-EFGH`);
    expect(textoQrReclamo(ID, "ABCD-2345-EFGH")).toBe(`lympha://reclamar?n=${ID}&c=ABCD-2345-EFGH`);
    expect(textoQrNodo(ID)).toBe(`lympha://nodo?n=${ID}`);
  });

  it("dibuja dos QR y el texto, sin afirmar nada del agua", () => {
    const svg = etiquetaSvg({
      deviceId: ID,
      codigoReclamo: "ABCD2345EFGH",
      loteId: "L1",
      versionHw: "v1",
    });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.match(/<g fill="#000">/g)).toHaveLength(2);
    expect(svg).toContain("ABCD-2345-EFGH");
    expect(svg).toContain(ID);
    expect(svg.toLowerCase()).not.toMatch(/potable|seguro/);
  });

  it("escapa el texto de la etiqueta", () => {
    const svg = etiquetaSvg({
      deviceId: ID,
      codigoReclamo: "ABCD2345EFGH",
      loteId: "<L>",
      versionHw: "v1",
    });
    expect(svg).not.toContain("<L>");
  });
});
