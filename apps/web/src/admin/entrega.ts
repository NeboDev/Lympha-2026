import type { EtiquetaEntregadaApi } from "@lympha/contracts";
import type { ArchivoZip } from "./zip.ts";

export interface LoteEntregado {
  loteId: string;
  creadoEn: string;
  versionHw: string;
  etiquetas: EtiquetaEntregadaApi[];
}

/** Etiquetas por hoja A4 con márgenes de 10 mm: 2 columnas × 6 filas de 80 × 44 mm. */
export const ETIQUETAS_POR_HOJA = 12;

export type ModoImpresion = "hoja" | "rollo";

/** Regla `@page` del modo: hoja A4 con varias etiquetas, o una etiqueta de 80 × 44 mm por página (rollo). */
export function reglaPagina(modo: ModoImpresion): string {
  return modo === "hoja"
    ? "@page { size: A4; margin: 10mm; }"
    : "@page { size: 80mm 44mm; margin: 0; }";
}

/** Dirección `data:` del SVG: se muestra con `<img>`, que nunca ejecuta código del SVG. */
export function svgComoUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Archivos del ZIP, con la misma forma que escribe `pnpm factory lote` en `tools/factory/lotes/<loteId>/`:
 * `manifiesto.json` (sin secretos) e `identidades.json` (contraseña MQTT, clave del AP y código de reclamo), más las
 * etiquetas en SVG. Con ellos se pueden grabar los nodos (`pnpm factory imagenes|grabar`).
 */
export function archivosDelLote(l: LoteEntregado): ArchivoZip[] {
  const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
  return [
    {
      nombre: "manifiesto.json",
      contenido: json({
        loteId: l.loteId,
        creadoEn: l.creadoEn,
        entorno: "panel",
        cantidad: l.etiquetas.length,
        versionHw: l.versionHw,
        notas: null,
        nodos: l.etiquetas.map((e) => ({ deviceId: e.device_id })),
      }),
    },
    {
      nombre: "identidades.json",
      contenido: json({
        loteId: l.loteId,
        entorno: "panel",
        nodos: l.etiquetas.map((e) => ({
          deviceId: e.device_id,
          mqttPassword: e.mqtt_password,
          apKey: e.ap_key,
          codigoReclamo: e.codigo_reclamo,
        })),
      }),
    },
    ...l.etiquetas.map((e) => ({ nombre: `etiquetas/${e.device_id}.svg`, contenido: e.svg })),
  ];
}

/** Baja un archivo generado en el navegador (nada pasa por el servidor). */
export function descargar(nombre: string, datos: BlobPart, tipo: string): void {
  const url = URL.createObjectURL(new Blob([datos], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
