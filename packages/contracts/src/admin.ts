import { z } from "zod";
import { estadoNodo } from "./api.ts";

/**
 * Panel de administración de plataforma (`/api/admin/*`). Solo lo ve quien está en `app.admins_plataforma`;
 * para todos los demás estas rutas no existen (404). Ningún contrato incluye datos de agua.
 */

const uuid = z.string().uuid();

/** Máximo de nodos por lote desde el panel: cada etiqueta viaja como SVG en la misma respuesta. */
export const MAX_NODOS_LOTE_PANEL = 50;

export const crearLoteBody = z
  .object({
    cantidad: z.number().int().min(1).max(MAX_NODOS_LOTE_PANEL),
    version_hw: z.string().trim().min(1).max(40).default("v1"),
    notas: z.string().trim().max(200).optional(),
  })
  .strict();
export type CrearLoteBody = z.infer<typeof crearLoteBody>;

/** Acción destructiva: el servidor exige la confirmación explícita además de la que pide la interfaz. */
export const confirmarBody = z.object({ confirmar: z.literal(true) }).strict();

export const conteoNodosApi = z.object({
  fabricado: z.number().int(),
  reclamado: z.number().int(),
  activo: z.number().int(),
  desvinculado: z.number().int(),
  revocado: z.number().int(),
});

export const loteAdminApi = z.object({
  id: uuid,
  creado_en: z.string().datetime(),
  cantidad: z.number().int(),
  version_hw: z.string(),
  notas: z.string().nullable(),
  revocado_en: z.string().datetime().nullable(),
  nodos: conteoNodosApi,
});
export type LoteAdminApi = z.infer<typeof loteAdminApi>;
export const listaLotesAdminRespuesta = z.object({ lotes: z.array(loteAdminApi) });

/**
 * Lo que sale UNA sola vez al crear un lote o regenerar una etiqueta. Incluye secretos del nodo (contraseña MQTT,
 * clave del AP, código de reclamo): nada de esto se guarda en claro en ningún lado.
 */
export const etiquetaEntregadaApi = z.object({
  device_id: uuid,
  lote_id: uuid,
  codigo_reclamo: z.string(),
  ap_key: z.string(),
  red_ap: z.string(),
  mqtt_password: z.string(),
  /** Etiqueta de 80 × 44 mm lista para imprimir. */
  svg: z.string(),
});
export type EtiquetaEntregadaApi = z.infer<typeof etiquetaEntregadaApi>;

export const loteCreadoRespuesta = z.object({
  lote_id: uuid,
  creado_en: z.string().datetime(),
  version_hw: z.string(),
  etiquetas: z.array(etiquetaEntregadaApi),
});
export type LoteCreadoRespuesta = z.infer<typeof loteCreadoRespuesta>;

export const regenerarEtiquetaRespuesta = z.object({ etiqueta: etiquetaEntregadaApi });

export const listaNodosAdminQuery = z
  .object({
    lote: uuid.optional(),
    estado: estadoNodo.optional(),
    q: z.string().trim().max(40).optional(),
    limite: z.coerce.number().int().min(1).max(100).default(50),
    desplazamiento: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const nodoAdminApi = z.object({
  id: uuid,
  lote_id: uuid,
  estado: estadoNodo,
  /** ¿Pertenece a un espacio? (quién, solo por la vista «Pertenece a», que se registra). */
  asignado: z.boolean(),
  version_fw: z.string().nullable(),
  creado_en: z.string().datetime(),
  reclamado_en: z.string().datetime().nullable(),
});
export type NodoAdminApi = z.infer<typeof nodoAdminApi>;
export const listaNodosAdminRespuesta = z.object({
  nodos: z.array(nodoAdminApi),
  total: z.number().int(),
});

export const nodoAdminDetalleApi = nodoAdminApi.extend({
  perfil_id: z.string(),
  lote: z.object({
    id: uuid,
    creado_en: z.string().datetime(),
    version_hw: z.string(),
    revocado_en: z.string().datetime().nullable(),
  }),
});
export type NodoAdminDetalleApi = z.infer<typeof nodoAdminDetalleApi>;

/** Respuesta de «Pertenece a». Cada consulta queda en la auditoría de la plataforma. */
export const perteneceARespuesta = z.object({
  nodo_id: uuid,
  espacio_id: uuid.nullable(),
  espacio_nombre: z.string().nullable(),
  propietario_id: uuid.nullable(),
  propietario_email: z.string().nullable(),
  propietario_nombre: z.string().nullable(),
});
export type PerteneceARespuesta = z.infer<typeof perteneceARespuesta>;

export const revocarLoteRespuesta = z.object({ nodos_revocados: z.number().int() });
