import QRCode from "qrcode";
import { formatearCodigoReclamo } from "./identidad.ts";

export interface DatosEtiqueta {
  deviceId: string;
  /** Con o sin guiones. */
  codigoReclamo: string;
  loteId: string;
  versionHw: string;
}

/** Contenido del QR de reclamo; es el formato que lee la PWA (`apps/web/src/nodos/codigo-qr.ts`). */
export function textoQrReclamo(deviceId: string, codigo: string): string {
  return `lympha://reclamar?n=${deviceId}&c=${formatearCodigoReclamo(codigo.replaceAll("-", ""))}`;
}

/** Contenido del segundo QR: identifica el nodo en fábrica y soporte, sin el código de reclamo. */
export function textoQrNodo(deviceId: string): string {
  return `lympha://nodo?n=${deviceId}`;
}

function escapar(t: string): string {
  return t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function qrComoRectas(texto: string, x: number, y: number, lado: number): string {
  const qr = QRCode.create(texto, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const paso = lado / (n + 2);
  const celdas: string[] = [];
  for (let fila = 0; fila < n; fila++) {
    for (let col = 0; col < n; col++) {
      if (qr.modules.get(col, fila)) {
        celdas.push(
          `<rect x="${(x + (col + 1) * paso).toFixed(3)}" y="${(y + (fila + 1) * paso).toFixed(3)}" width="${paso.toFixed(3)}" height="${paso.toFixed(3)}"/>`,
        );
      }
    }
  }
  return `<g fill="#000">${celdas.join("")}</g>`;
}

/**
 * Etiqueta de 80 × 40 mm en SVG con dos QR (reclamo y nodo) y el texto. No afirma nada del agua (RNF-32).
 */
export function etiquetaSvg(d: DatosEtiqueta): string {
  const codigo = formatearCodigoReclamo(d.codigoReclamo.replaceAll("-", ""));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="40mm" viewBox="0 0 80 40">`,
    `<rect width="80" height="40" fill="#fff"/>`,
    qrComoRectas(textoQrReclamo(d.deviceId, d.codigoReclamo), 2, 2, 26),
    qrComoRectas(textoQrNodo(d.deviceId), 52, 2, 26),
    `<g font-family="monospace" fill="#000" text-anchor="middle">`,
    `<text x="40" y="9" font-size="4" font-family="sans-serif" font-weight="bold">Lympha</text>`,
    `<text x="40" y="14" font-size="2.2" font-family="sans-serif">Escanea para reclamar</text>`,
    `<text x="15" y="31" font-size="2.6">Reclamo</text>`,
    `<text x="65" y="31" font-size="2.6">Nodo</text>`,
    `<text x="40" y="35" font-size="3.4" font-weight="bold">${escapar(codigo)}</text>`,
    `<text x="40" y="38.5" font-size="1.9">${escapar(d.deviceId)} · ${escapar(d.loteId)} · ${escapar(d.versionHw)}</text>`,
    `</g>`,
    `</svg>`,
    "",
  ].join("\n");
}
