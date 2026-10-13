export { type AvisoPorEncolar, encolarAvisos, type PayloadAviso } from "./encolar.ts";
export {
  type CanalTelegram,
  crearEnviador,
  type Enviador,
  type MetricasEnviador,
  type OpcionesEnviador,
} from "./enviador.ts";
export {
  ARRENDAMIENTO_S,
  CANAL_SALIDA,
  contarAlarmasAbiertas,
  contarPendientes,
  type Escucha,
  escucharSalida,
  type FilaSalida,
  reclamarPendientes,
} from "./outbox.ts";
export { type Decision, decidirTrasError, ESPERAS_S, INTENTOS_MAXIMOS } from "./reintentos.ts";
