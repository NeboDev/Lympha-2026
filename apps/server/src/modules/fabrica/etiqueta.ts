import QRCode from "qrcode";
import { formatearCodigoReclamo } from "./identidad.ts";

export interface DatosEtiqueta {
  deviceId: string;
  /** Con o sin guiones. */
  codigoReclamo: string;
  loteId: string;
  versionHw: string;
  /** Clave del punto de acceso del portal cautivo (la `apKey` de `identidades.json`). */
  apKey: string;
}

/** Contenido del QR de reclamo; es el formato que lee la PWA (`apps/web/src/nodos/codigo-qr.ts`). */
export function textoQrReclamo(deviceId: string, codigo: string): string {
  return `lympha://reclamar?n=${deviceId}&c=${formatearCodigoReclamo(codigo.replaceAll("-", ""))}`;
}

/**
 * Nombre del punto de acceso del portal cautivo: «Lympha-» y los últimos 4 caracteres del deviceId en minúsculas.
 * Tiene que coincidir con `lympha_portal_ssid_ap()` del firmware (`lympha-firmware`, components/provisioning).
 */
export function nombreAp(deviceId: string): string {
  return `Lympha-${deviceId.slice(-4).toLowerCase()}`;
}

/**
 * Contenido del segundo QR: el formato estándar para unirse a una red WiFi, que el teléfono lee con la cámara y se
 * une solo al punto de acceso del nodo. Igual que `lympha_portal_qr_wifi()` del firmware: se escapan la barra
 * invertida, el punto y coma, la coma, los dos puntos y las comillas.
 */
export function textoQrWifi(ssid: string, clave: string): string {
  const esc = (t: string) => t.replace(/[\\;,:"]/g, (c) => `\\${c}`);
  return `WIFI:T:WPA;S:${esc(ssid)};P:${esc(clave)};;`;
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
 * Etiqueta de 80 × 44 mm en SVG con dos QR (reclamo en la app y unión al WiFi del sensor), la red y su clave, y el
 * código de reclamo. No afirma nada del agua (RNF-32). Contiene la clave del AP y el código en claro.
 */
export function etiquetaSvg(d: DatosEtiqueta): string {
  const codigo = formatearCodigoReclamo(d.codigoReclamo.replaceAll("-", ""));
  const red = nombreAp(d.deviceId);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="44mm" viewBox="0 0 80 44">`,
    `<rect width="80" height="44" fill="#fff"/>`,
    qrComoRectas(textoQrReclamo(d.deviceId, d.codigoReclamo), 2, 2, 26),
    qrComoRectas(textoQrWifi(red, d.apKey), 52, 2, 26),
    `<g font-family="monospace" fill="#000" text-anchor="middle">`,
    `<text x="40" y="9" font-size="4" font-family="sans-serif" font-weight="bold">Lympha</text>`,
    `<text x="40" y="14" font-size="2.2" font-family="sans-serif">Escanea para instalar</text>`,
    `<text x="15" y="31" font-size="2.4" font-family="sans-serif">1. Reclamo</text>`,
    `<text x="65" y="31" font-size="2.4" font-family="sans-serif">2. WiFi del sensor</text>`,
    `<text x="40" y="34.8" font-size="2.5">Red ${escapar(red)} · Clave ${escapar(d.apKey)}</text>`,
    `<text x="40" y="39" font-size="3.4" font-weight="bold">${escapar(codigo)}</text>`,
    `<text x="40" y="42.5" font-size="1.9">${escapar(d.deviceId)} · ${escapar(d.loteId)} · ${escapar(d.versionHw)}</text>`,
    `</g>`,
    `</svg>`,
    "",
  ].join("\n");
}
