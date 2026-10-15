import type {
  ConexionNodo,
  EstadoNodoEvento,
  EventoConexion,
  EventoSnapshot,
  NodoApi,
  ValoresApi,
} from "@lympha/contracts";

/**
 * Lo que la tarjeta de un nodo muestra (RF-18, RF-20, RF-22). Un solo valor resume el semáforo:
 * los cuatro niveles más los estados que no son un color de calidad.
 */
export type EstadoVisible =
  | "buena"
  | "regular"
  | "mala"
  | "critica"
  | "sin_datos"
  | "revisar" // sensor a revisar y nada más que afirmar
  | "sin_conexion"
  | "esperando" // reclamado, sin primera lectura
  | "deshabilitado"
  | "sin_vincular";

export interface NodoVista {
  id: string;
  nombre: string | null;
  visible: EstadoVisible;
  wqi: number | null;
  causa: string | null;
  accion: string | null;
  /** Parámetro responsable del nivel o sensor a revisar. */
  parametroLimitante: string | null;
  /** Hay un sensor por revisar aunque el nivel (malo o crítico) se conserve (H2: lo miden otros sensores). */
  sensorPorRevisar: boolean;
  ultimaLecturaEn: string | null;
  /** Desde cuándo no hay datos, si el nodo está sin conexión. */
  sinDatosDesde: string | null;
  valores: ValoresApi | null;
}

/** Lo último que llegó por el stream, con el momento (del reloj de la PWA) en que llegó. */
export interface DatosSse {
  estados: Record<string, { dato: EstadoNodoEvento; recibido: number }>;
  conexiones: Record<string, { dato: ConexionNodo; recibido: number }>;
}

export const sseVacio: DatosSse = { estados: {}, conexiones: {} };

/** El snapshot reemplaza todo: lo que ya no está en el espacio se descarta y lo perdido durante una caída se corrige. */
export function conSnapshot(snapshot: EventoSnapshot, ahora: number): DatosSse {
  return {
    estados: Object.fromEntries(
      snapshot.nodos.map((n) => [n.nodo_id, { dato: n, recibido: ahora }]),
    ),
    conexiones: Object.fromEntries(
      snapshot.conexiones.map((c) => [c.nodo_id, { dato: c, recibido: ahora }]),
    ),
  };
}

export function conEstado(datos: DatosSse, evento: EstadoNodoEvento, ahora: number): DatosSse {
  return {
    ...datos,
    estados: { ...datos.estados, [evento.nodo_id]: { dato: evento, recibido: ahora } },
  };
}

export function conConexion(datos: DatosSse, evento: EventoConexion, ahora: number): DatosSse {
  const dato: ConexionNodo = {
    nodo_id: evento.nodo_id,
    conectado: evento.conectado,
    cambio_conexion_en: evento.cambio_conexion_en,
  };
  return {
    ...datos,
    conexiones: { ...datos.conexiones, [evento.nodo_id]: { dato, recibido: ahora } },
  };
}

/**
 * Une lo que dijo la API REST (nombres, ciclo de vida y estado al pedirla) con lo que llegó en vivo. Lo del stream
 * solo manda si llegó DESPUÉS de la última respuesta REST (`baseEn`): una respuesta más nueva ya lo incluye.
 */
export function combinar(base: NodoApi[], sse: DatosSse, baseEn: number): NodoVista[] {
  return base.map((n) => {
    const actual = n.estado_actual;
    const e = sse.estados[n.id];
    const c = sse.conexiones[n.id];
    const estadoVivo = e && e.recibido >= baseEn ? e.dato : null;
    const conexionViva = c && c.recibido >= baseEn ? c.dato : null;

    const nivel = estadoVivo?.nivel ?? actual?.nivel ?? "sin_datos";
    const confianza = estadoVivo?.confianza ?? actual?.confianza ?? "ok";
    const conectado = conexionViva?.conectado ?? actual?.conectado ?? null;
    const cambioConexion = conexionViva?.cambio_conexion_en ?? actual?.cambio_conexion_en ?? null;
    const ultimaLectura = estadoVivo?.ultima_lectura_en ?? actual?.ultima_lectura_en ?? null;
    const valoresRest = actual?.ultimos_valores as ValoresApi | null | undefined;

    return {
      id: n.id,
      nombre: n.nombre,
      // un nodo «reclamado» que ya mandó una evaluación en vivo dejó de esperar su primera lectura. El snapshot trae
      // una fila de estado por cada nodo, también el que todavía no ha mandado nada (sin lectura): eso no cuenta.
      visible: estadoVisible(
        n.estado === "reclamado" && estadoVivo?.ultima_lectura_en ? "activo" : n.estado,
        nivel,
        confianza,
        conectado,
      ),
      wqi: estadoVivo ? estadoVivo.wqi : (actual?.wqi ?? null),
      causa: estadoVivo ? estadoVivo.causa : (actual?.causa ?? null),
      accion: estadoVivo ? estadoVivo.accion : (actual?.accion ?? null),
      parametroLimitante: estadoVivo
        ? estadoVivo.parametro_limitante
        : (actual?.parametro_limitante ?? null),
      sensorPorRevisar: confianza === "revisar",
      ultimaLecturaEn: ultimaLectura,
      sinDatosDesde: conectado === false ? (cambioConexion ?? ultimaLectura) : null,
      valores: estadoVivo ? estadoVivo.valores : (valoresRest ?? null),
    };
  });
}

/**
 * Qué mostrar en lugar del color de calidad cuando no se puede afirmar nada (RF-18):
 *  - sin conexión manda sobre el último nivel: el dato ya no es de ahora (gris, «sin datos desde…»);
 *  - con un sensor a revisar, un nivel bueno o regular no se afirma (H2 ya lo deja en `sin_datos`); uno malo o
 *    crítico se conserva y se avisa aparte.
 */
export function estadoVisible(
  ciclo: NodoApi["estado"],
  nivel: EstadoNodoEvento["nivel"],
  confianza: EstadoNodoEvento["confianza"],
  conectado: boolean | null,
): EstadoVisible {
  if (ciclo === "revocado") return "deshabilitado";
  if (ciclo === "fabricado" || ciclo === "desvinculado") return "sin_vincular";
  if (ciclo === "reclamado") return "esperando";
  if (conectado === false) return "sin_conexion";
  if (nivel === "sin_datos") return confianza === "revisar" ? "revisar" : "sin_datos";
  return nivel;
}
