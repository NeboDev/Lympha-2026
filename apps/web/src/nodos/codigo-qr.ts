import { ALFABETO_CODIGO_RECLAMO, normalizarCodigoReclamo } from "@lympha/contracts";

export interface DatosReclamo {
  nodoId: string;
  /** Ya normalizado (sin separadores, en mayúsculas). */
  codigo: string;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const LONGITUD_CODIGO = 12;

const codigoValido = (codigo: string) =>
  codigo.length === LONGITUD_CODIGO &&
  [...codigo].every((c) => ALFABETO_CODIGO_RECLAMO.includes(c));

/**
 * Lee el contenido de la etiqueta del nodo: un enlace `lympha://reclamar?n=<deviceId>&c=<código>` (el formato
 * propuesto para el QR) o, de forma tolerante, un identificador y un código sueltos separados por espacios, comas
 * o saltos de línea. Devuelve `null` si falta alguno o el código no es de 12 caracteres del alfabeto de reclamo.
 */
export function interpretarReclamo(texto: string): DatosReclamo | null {
  const limpio = texto.trim();
  if (!limpio) return null;

  let nodo: string | null = null;
  let codigo: string | null = null;

  try {
    const url = new URL(limpio);
    nodo = url.searchParams.get("n") ?? url.searchParams.get("nodo");
    codigo = url.searchParams.get("c") ?? url.searchParams.get("codigo");
  } catch {
    // no es un enlace: se busca en el texto suelto
  }

  if (!nodo) nodo = limpio.match(UUID)?.[0] ?? null;
  if (!nodo || !UUID.test(nodo)) return null;
  if (!codigo) codigo = limpio.replace(UUID, " ").replace(/[^A-Za-z0-9\s-]/g, " ");

  const normalizado = normalizarCodigoReclamo(codigo);
  if (!codigoValido(normalizado)) return null;
  return { nodoId: nodo.toLowerCase(), codigo: normalizado };
}
