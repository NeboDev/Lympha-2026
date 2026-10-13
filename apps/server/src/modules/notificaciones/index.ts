export { type AvisoPorEncolar, encolarAvisos, type PayloadAviso } from "./encolar.ts";
export {
  CANAL_SALIDA,
  contarPendientes,
  type Escucha,
  escucharSalida,
  type FilaSalida,
  reclamarPendientes,
} from "./outbox.ts";
