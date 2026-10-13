export { aplicarCiclo, type EstadoConfirmado, type ResultadoCiclo } from "./ciclo.ts";
export { type DatosAviso, duracion, nombreNodo, textoAviso } from "./plantillas.ts";
export {
  type AccionNivel,
  type AccionSensor,
  ANTIGUEDAD_MAXIMA_AVISO_MIN,
  debeRecordar,
  decidirNivel,
  decidirSensor,
  esAvisable,
  minutosSinConexion,
  RANGO_SEVERIDAD,
  SIN_CONEXION_MIN_DEFECTO,
} from "./reglas.ts";
