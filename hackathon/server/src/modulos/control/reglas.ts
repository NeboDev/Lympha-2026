import type { ConfigActuador, NodoDoc } from "../nodos/index.ts";
import type { AccionDoc, AccionVista, Enclavamiento } from "./puertos.ts";

/**
 * Reglas puras del control del actuador. Son una segunda red de seguridad: los enclavamientos de verdad
 * (apagado al arrancar, pulso máximo, apagado sin datos válidos o sin comunicación) los decide el
 * firmware (docs/ARQUITECTURA.md §6). Aquí solo se evita *pedir* lo que no tiene sentido pedir.
 */

/** Lo que las reglas necesitan saber del nodo en este momento. */
export type SituacionNodo = Pick<NodoDoc, "ultimo" | "actuador">;

export const conexionDe = (
  n: Pick<NodoDoc, "ultimo">,
): "sin_lecturas" | "conectado" | "sin_datos" =>
  n.ultimo ? (n.ultimo.sin_datos ? "sin_datos" : "conectado") : "sin_lecturas";

/** Estados del agua en los que NO se dosifica y, si había un pulso, se detiene. */
const ESTADOS_SIN_DOSIFICAR = new Set(["fuera_de_rango", "critico"]);

/**
 * Por qué no se puede dar un pulso ahora (vacío = se puede). `activa` es la acción que ya ocupa el
 * actuador, si la hay; `ultimoFin`, cuándo terminó el último pulso.
 */
export function bloqueos(
  nodo: SituacionNodo,
  activa: Pick<AccionDoc, "estado"> | null,
  ultimoFin: Date | null,
  ahora: Date,
): Enclavamiento[] {
  const config = nodo.actuador;
  if (!config?.habilitado) {
    return [{ codigo: "sin_actuador", mensaje: "Este nodo no tiene un actuador habilitado." }];
  }
  const lista: Enclavamiento[] = [];
  const conexion = conexionDe(nodo);
  const u = nodo.ultimo;
  if (conexion !== "conectado" || !u) {
    lista.push({
      codigo: "sin_datos",
      mensaje: "El nodo no está enviando datos: sin un pH válido no se dosifica.",
    });
  } else if (u.estado === "revisar_sensor") {
    lista.push({
      codigo: "sensor",
      mensaje: "La lectura del pH no es confiable: primero hay que revisar la sonda.",
    });
  } else if (u.estado !== null && ESTADOS_SIN_DOSIFICAR.has(u.estado)) {
    lista.push({
      codigo: "fuera_de_rango",
      mensaje: "El pH está fuera de rango: no se dosifica. Primero hay que corregir el pH.",
    });
  } else if (u.estado === null) {
    lista.push({ codigo: "sin_datos", mensaje: "Todavía no hay un estado del agua evaluado." });
  }
  if (activa?.estado === "en_curso") {
    lista.push({ codigo: "pulso_en_curso", mensaje: "Ya hay un pulso en curso." });
  }
  if (ultimoFin) {
    const faltan = Math.ceil(
      (ultimoFin.getTime() + config.enfriamiento_s * 1000 - ahora.getTime()) / 1000,
    );
    if (faltan > 0) {
      lista.push({
        codigo: "enfriamiento",
        mensaje: `Hay que esperar ${faltan >= 120 ? `${Math.ceil(faltan / 60)} min` : `${faltan} s`} más desde el pulso anterior.`,
      });
    }
  }
  return lista;
}

export type MotivoDetencion = "fuera_de_rango" | "sensor" | "sin_datos";

/**
 * ¿Hay que detener un pulso en curso por seguridad? Solo si el nodo lo permite (`auto_detener`). Detener
 * es lo único que Atl hace solo: subir la dosis nunca es automático.
 */
export function motivoParaDetener(
  nodo: SituacionNodo,
  activa: Pick<AccionDoc, "estado"> | null,
): MotivoDetencion | null {
  const config = nodo.actuador;
  if (!config?.habilitado || !config.auto_detener || activa?.estado !== "en_curso") return null;
  if (conexionDe(nodo) === "sin_datos") return "sin_datos";
  const estado = nodo.ultimo?.estado;
  if (estado === "revisar_sensor") return "sensor";
  if (estado && ESTADOS_SIN_DOSIFICAR.has(estado)) return "fuera_de_rango";
  return null;
}

/** Una duración de pulso válida: entera, de 1 s hasta el máximo del nodo. */
export function duracionValida(
  config: Pick<ConfigActuador, "pulso_max_s">,
  duracionS: number,
): boolean {
  return Number.isInteger(duracionS) && duracionS >= 1 && duracionS <= config.pulso_max_s;
}

export function vistaDeAccion(a: AccionDoc): AccionVista {
  return {
    id: a._id.toHexString(),
    estado: a.estado,
    duracion_s: a.duracion_s,
    solicitada: a.solicitada,
    expira: a.expira,
    inicio: a.inicio,
    fin: a.fin,
    motivo: a.motivo,
    detalle: a.detalle,
    automatica: a.automatica,
    simulado: a.simulado,
  };
}
