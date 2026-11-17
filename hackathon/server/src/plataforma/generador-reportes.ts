import type { ObjectId } from "mongodb";
import type { ReporteGenerado, ServicioReportes } from "../modulos/reportes/index.ts";
import type { LogoSvg } from "./logo-svg.ts";
import { renderizarPdf } from "./reporte-pdf.ts";

/** «Tinaco azotea», 2026-11-19 → «reporte-tinaco-azotea-2026-11-19.pdf». */
export function nombreArchivoReporte(nodo: string, generado: Date): string {
  const slug = nodo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `reporte-${slug || "nodo"}-${generado.toISOString().slice(0, 10)}.pdf`;
}

export type ReportePdf = { pdf: Buffer; nombreArchivo: string; reporte: ReporteGenerado };

/**
 * Une el servicio de reportes (datos) con el dibujo del PDF. Es lo único que web, Telegram y la
 * línea de comandos piden: ninguno conoce el detalle del otro.
 */
export function crearGeneradorPdf(op: { servicio: ServicioReportes; logo: LogoSvg }) {
  async function aPdf(reporte: ReporteGenerado): Promise<ReportePdf> {
    const pdf = await renderizarPdf(
      reporte.contenido,
      {
        id: reporte.id,
        hash: reporte.hash,
        generado: reporte.generado,
        generadoPor: reporte.generadoPor,
      },
      op.logo,
    );
    return {
      pdf,
      nombreArchivo: nombreArchivoReporte(reporte.contenido.nodo.nombre, reporte.generado),
      reporte,
    };
  }

  return {
    async ultimosDias(nodoId: ObjectId, dias: number, generadoPor: string): Promise<ReportePdf> {
      return aPdf(await op.servicio.ultimosDias(nodoId, dias, generadoPor));
    },
    async periodo(
      nodoId: ObjectId,
      desde: Date,
      hasta: Date,
      generadoPor: string,
    ): Promise<ReportePdf> {
      return aPdf(await op.servicio.generar({ nodoId, desde, hasta, generadoPor }));
    },
  };
}

export type GeneradorPdf = ReturnType<typeof crearGeneradorPdf>;
