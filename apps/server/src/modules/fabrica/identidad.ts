import { randomBytes, randomInt } from "node:crypto";
import { ALFABETO_CODIGO_RECLAMO } from "@lympha/contracts";

/** Código de reclamo: 12 caracteres de un alfabeto sin ambiguos (≈ 59 bits). */
export function generarCodigoReclamo(): string {
  let c = "";
  for (let i = 0; i < 12; i++)
    c += ALFABETO_CODIGO_RECLAMO[randomInt(ALFABETO_CODIGO_RECLAMO.length)];
  return c;
}

/** Como se imprime en la etiqueta: grupos de 4 separados por guion. */
export function formatearCodigoReclamo(codigo: string): string {
  return codigo.match(/.{1,4}/g)?.join("-") ?? codigo;
}

/** Contraseña MQTT del nodo: 32 caracteres (24 bytes aleatorios en base64url). */
export function generarPasswordMqtt(): string {
  return randomBytes(24).toString("base64url");
}

/** Clave del punto de acceso del portal cautivo: 10 caracteres sin ambiguos (≥ 8 que exige WPA2). */
export function generarClaveAp(): string {
  let c = "";
  for (let i = 0; i < 10; i++)
    c += ALFABETO_CODIGO_RECLAMO[randomInt(ALFABETO_CODIGO_RECLAMO.length)];
  return c;
}
