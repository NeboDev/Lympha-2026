import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { AlertaDoc } from "../modulos/alertas/index.ts";
import { construirContenido, type MuestraReporte } from "../modulos/reportes/index.ts";
import { catalogoDePrueba, nodoDePrueba, T0 } from "../test/falsos.ts";
import { nombreArchivoReporte } from "./generador-reportes.ts";
import { cargarSimboloLympha } from "./logo-svg.ts";
import { renderizarPdf } from "./reporte-pdf.ts";

const HORA = 3600_000;
const logo = cargarSimboloLympha();

function contenido(
  opciones: { horas?: number; ph?: (i: number) => number | null; con?: boolean } = {},
) {
  const horas = opciones.horas ?? 48;
  const ph = opciones.ph ?? ((i: number) => 7 + Math.sin(i / 90) * 0.4);
  const nodo = nodoDePrueba(new ObjectId(), "Tinaco azotea");
  const muestras: MuestraReporte[] = [];
  for (let i = 0; i < horas * 12; i++) {
    const v = ph(i);
    if (v !== null) muestras.push({ ts: new Date(T0 - horas * HORA + i * 300_000), v: { ph: v } });
  }
  const alerta: AlertaDoc = {
    _id: new ObjectId(),
    nodo_id: nodo._id,
    comunidad_id: nodo.comunidad_id,
    tipo: "nivel",
    parametro: "ph",
    severidad: "alta",
    severidad_maxima: "critica",
    estado: "cerrada",
    abierta: new Date(T0 - 20 * HORA),
    cerrada: new Date(T0 - 19 * HORA),
    ultimo_aviso: null,
    recordatorios: 0,
    valor_apertura: 5.2,
    valor_cierre: 7,
  };
  return construirContenido({
    marca: "Lympha Atl",
    comunidad: "Primaria Benito Juárez",
    nodo,
    desde: new Date(T0 - horas * HORA),
    hasta: new Date(T0),
    muestras,
    alertas: opciones.con === false ? [] : [alerta],
    eventos:
      opciones.con === false
        ? []
        : [
            {
              ts: new Date(T0 - 30 * HORA),
              tipo: "sin_datos",
              mensaje: "El nodo dejó de enviar datos.",
            },
            {
              ts: new Date(T0 - 10 * HORA),
              tipo: "bitacora",
              mensaje: "Se lavó el tinaco y se cambió la sonda.",
            },
          ],
    calibraciones:
      opciones.con === false
        ? []
        : [
            {
              _id: new ObjectId(),
              nodo_id: nodo._id,
              ts: new Date(T0 - 40 * HORA),
              parametro: "ph",
              pendiente_pct_nernst: 98.1,
              offset_mv: 3,
              diagnostico: "buena",
            },
          ],
    catalogo: catalogoDePrueba,
  });
}

const meta = {
  id: "6afb9b239fdb326fb941e2fb",
  hash: `sha256:${"ab".repeat(32)}`,
  generado: new Date(T0),
  generadoPor: "Prueba",
};
const paginas = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;

describe("renderizarPdf", () => {
  it("genera un PDF carta válido y no vacío", async () => {
    const pdf = await renderizarPdf(contenido(), meta, logo);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.subarray(-6).toString("latin1")).toContain("%%EOF");
    expect(pdf.length).toBeGreaterThan(8_000);
    expect(paginas(pdf)).toBeGreaterThanOrEqual(1);
    expect(pdf.toString("latin1")).toContain("/MediaBox [0 0 612 792]");
  });

  it("sin datos, sin alertas y sin calibraciones también genera el reporte", async () => {
    const pdf = await renderizarPdf(contenido({ ph: () => null, con: false }), meta, logo);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(5_000);
  });

  it("con huecos en los datos no se rompe", async () => {
    const pdf = await renderizarPdf(
      contenido({ ph: (i) => (i % 400 < 60 ? null : 6 + (i % 7) * 0.5) }),
      meta,
      logo,
    );
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("muchos eventos pasan a más de una página sin perder el pie", async () => {
    const c = contenido();
    const eventos = Array.from({ length: 80 }, (_, i) => ({
      ts: new Date(T0 - i * 60_000),
      titulo: "Nodo sin datos",
      detalle: "El nodo dejó de enviar datos y volvió a hacerlo poco después.",
    }));
    const pdf = await renderizarPdf({ ...c, eventos }, meta, logo);
    expect(paginas(pdf)).toBeGreaterThanOrEqual(2);
  });

  it("dos reportes con distinto contenido no son iguales", async () => {
    const a = await renderizarPdf(contenido({ ph: () => 7 }), meta, logo);
    const b = await renderizarPdf(contenido({ ph: () => 5 }), meta, logo);
    expect(a.equals(b)).toBe(false);
  });
});

describe("nombreArchivoReporte", () => {
  it("limpia acentos y símbolos", () => {
    expect(nombreArchivoReporte("Tinaco azotea", new Date(T0))).toBe(
      "reporte-tinaco-azotea-2026-11-19.pdf",
    );
    expect(nombreArchivoReporte("¡Pozo Ñandú / norte!", new Date(T0))).toBe(
      "reporte-pozo-nandu-norte-2026-11-19.pdf",
    );
    expect(nombreArchivoReporte("???", new Date(T0))).toBe("reporte-nodo-2026-11-19.pdf");
  });
});
