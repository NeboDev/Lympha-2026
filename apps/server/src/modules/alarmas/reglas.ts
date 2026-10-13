import type { SeveridadAlarma } from "@lympha/contracts";
import type { Confianza, Nivel } from "@lympha/wqi";

/**
 * Reglas del ciclo de vida de las alarmas. Funciones puras: deciden qué hacer a partir de la alarma
 * abierta (o ninguna) y del estado confirmado del nodo. La histéresis ya la resolvió `@lympha/wqi`;
 * aquí no se vuelve a suavizar nada.
 *
 * Como deciden contra la alarma abierta y no contra "el estado anterior", son idempotentes: repetir la
 * misma evaluación (reintento de un lote tras una caída) no produce ninguna acción.
 */

export const RANGO_SEVERIDAD: Record<SeveridadAlarma, number> = { regular: 1, mala: 2, critica: 3 };

export type AccionNivel =
  | { tipo: "ninguna" }
  | { tipo: "abrir"; severidad: SeveridadAlarma }
  | { tipo: "escalar"; severidad: SeveridadAlarma; anterior: SeveridadAlarma }
  | { tipo: "mejorar"; severidad: SeveridadAlarma; anterior: SeveridadAlarma }
  | { tipo: "resolver"; anterior: SeveridadAlarma };

const esSeveridad = (n: Nivel): n is SeveridadAlarma =>
  n === "regular" || n === "mala" || n === "critica";

/**
 * Alarma de nivel. `abierta` es la severidad de la alarma abierta del nodo (`null` si no hay) y `nuevo`
 * el nivel confirmado. `sin_datos` no abre, ni mejora ni resuelve: no se puede afirmar que el agua
 * mejoró cuando no se sabe cómo está (de un sensor en falla se ocupa la alarma de sensor).
 */
export function decidirNivel(abierta: SeveridadAlarma | null, nuevo: Nivel): AccionNivel {
  if (nuevo === "sin_datos") return { tipo: "ninguna" };
  if (abierta === null) {
    return esSeveridad(nuevo) ? { tipo: "abrir", severidad: nuevo } : { tipo: "ninguna" };
  }
  if (!esSeveridad(nuevo)) return { tipo: "resolver", anterior: abierta };
  const delta = RANGO_SEVERIDAD[nuevo] - RANGO_SEVERIDAD[abierta];
  if (delta > 0) return { tipo: "escalar", severidad: nuevo, anterior: abierta };
  if (delta < 0) return { tipo: "mejorar", severidad: nuevo, anterior: abierta };
  return { tipo: "ninguna" };
}

export type AccionSensor = "ninguna" | "abrir" | "resolver";

/**
 * Alarma de sensor (RF-39). Se abre con confianza `revisar`; se cierra cuando todos los sensores vuelven a
 * `ok`. `dudosa` (un sensor sin dato) ni abre ni cierra: es el escalón intermedio de la histéresis.
 */
export function decidirSensor(abierta: boolean, confianza: Confianza): AccionSensor {
  if (!abierta) return confianza === "revisar" ? "abrir" : "ninguna";
  return confianza === "ok" ? "resolver" : "ninguna";
}

/** Un lote recuperado de hace horas actualiza el estado pero no avisa de algo que ya pasó. */
export const ANTIGUEDAD_MAXIMA_AVISO_MIN = 30;

export function esAvisable(
  tsMs: number,
  ahoraMs: number,
  maximoMin: number = ANTIGUEDAD_MAXIMA_AVISO_MIN,
): boolean {
  return ahoraMs - tsMs <= maximoMin * 60_000;
}

/** Minutos sin conexión antes de alarmar (RF-29) si el perfil no define otro valor. */
export const SIN_CONEXION_MIN_DEFECTO = 10;

/** Lee `perfiles_uso.reglas_alarma`; cualquier cosa que no sea un número positivo usa el valor por defecto. */
export function minutosSinConexion(reglas: unknown): number {
  if (typeof reglas === "object" && reglas !== null && "sin_conexion_min" in reglas) {
    const m = (reglas as { sin_conexion_min: unknown }).sin_conexion_min;
    if (typeof m === "number" && Number.isFinite(m) && m >= 1) return m;
  }
  return SIN_CONEXION_MIN_DEFECTO;
}

/** ¿Toca un recordatorio? Cuenta desde el último aviso de esa alarma a ese usuario (RF-30). */
export function debeRecordar(
  ultimoAvisoMs: number,
  ahoraMs: number,
  recordatorioHoras: number,
): boolean {
  return ahoraMs - ultimoAvisoMs >= recordatorioHoras * 3_600_000;
}
