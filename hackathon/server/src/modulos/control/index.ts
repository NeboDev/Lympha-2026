export type {
  AccionDoc,
  AccionVista,
  AlmacenControl,
  Enclavamiento,
  EscritorActuador,
  EstadoAccion,
  EventoActuador,
  LoggerControl,
} from "./puertos.ts";
export { ESTADOS_ACTIVOS } from "./puertos.ts";
export {
  bloqueos,
  conexionDe,
  duracionValida,
  type MotivoDetencion,
  motivoParaDetener,
  type SituacionNodo,
  vistaDeAccion,
} from "./reglas.ts";
export {
  type Control,
  crearControl,
  type DatosConfigActuador,
  ENFRIAMIENTO_MAX_S,
  type EstadoControl,
  type OpcionesControl,
  PULSO_MAX_TOPE_S,
  VIGENCIA_CONFIRMACION_S,
} from "./servicio.ts";
