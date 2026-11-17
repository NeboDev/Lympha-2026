import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** AES-256-GCM para el token de Blynk, que da control total del dispositivo. */

const VERSION = "v1";

/** Convierte la clave en base64 (`ATL_CLAVE_CIFRADO`) a 32 bytes; error si no lo son. */
export function claveDesdeBase64(base64: string): Buffer {
  const clave = Buffer.from(base64, "base64");
  if (clave.length !== 32) throw new Error("La clave de cifrado debe ser de 32 bytes en base64");
  return clave;
}

/** Devuelve `v1:iv:etiqueta:cifrado` (todo en base64). Cada llamada usa un IV nuevo. */
export function cifrar(texto: string, clave: Buffer): string {
  const iv = randomBytes(12);
  const cifrador = createCipheriv("aes-256-gcm", clave, iv);
  const cifrado = Buffer.concat([cifrador.update(texto, "utf8"), cifrador.final()]);
  const etiqueta = cifrador.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    etiqueta.toString("base64"),
    cifrado.toString("base64"),
  ].join(":");
}

/** Inverso de `cifrar`. Falla con un mensaje genérico si el paquete o la clave no coinciden. */
export function descifrar(paquete: string, clave: Buffer): string {
  const [version, iv, etiqueta, cifrado] = paquete.split(":");
  if (version !== VERSION || !iv || !etiqueta || !cifrado) {
    throw new Error("No se pudo descifrar el valor");
  }
  try {
    const descifrador = createDecipheriv("aes-256-gcm", clave, Buffer.from(iv, "base64"));
    descifrador.setAuthTag(Buffer.from(etiqueta, "base64"));
    return Buffer.concat([
      descifrador.update(Buffer.from(cifrado, "base64")),
      descifrador.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("No se pudo descifrar el valor");
  }
}
