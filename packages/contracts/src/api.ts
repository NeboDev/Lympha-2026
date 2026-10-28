import { z } from "zod";
import { resumenCalibracion } from "./calibracion.ts";

const componente = z.enum(["ok", "error"]);

export const respuestaHealth = z.object({
  estado: z.enum(["ok", "degradado"]),
  version: z.string(),
  componentes: z.object({
    postgres: componente,
    valkey: componente,
    mqtt: componente,
  }),
});
export type RespuestaHealth = z.infer<typeof respuestaHealth>;

export const lecturaApi = z.object({
  nodo_id: z.string().uuid(),
  ts: z.string().datetime(),
  seq: z.number().int(),
  ph: z.number().nullable(),
  temperatura: z.number().nullable(),
  conductividad: z.number().nullable(),
  turbidez: z.number().nullable(),
  tds: z.number().nullable(),
  /** Valor sin calibrar de cada parámetro que se corrigió; ausente o nulo si la lectura no se corrigió. */
  crudo: z.record(z.number()).nullable().optional(),
});
export type LecturaApi = z.infer<typeof lecturaApi>;

export const respuestaError = z.object({
  codigo: z.string(),
  mensaje: z.string(),
});
export type RespuestaError = z.infer<typeof respuestaError>;

// ---------------------------------------------------------------------------------------------
// H1: identidad, espacios, membresías y nodos. Cuerpos `.strict()`: lo desconocido se rechaza.
// ---------------------------------------------------------------------------------------------

export const tipoEspacio = z.enum(["hogar", "escuela", "pyme", "hotel", "otro"]);
export type TipoEspacio = z.infer<typeof tipoEspacio>;
export const rolEspacio = z.enum(["propietario", "miembro"]);
export type RolEspacio = z.infer<typeof rolEspacio>;
export const nivel = z.enum(["buena", "regular", "mala", "critica", "sin_datos"]);
export const estadoNodo = z.enum(["fabricado", "reclamado", "activo", "desvinculado", "revocado"]);

const uuid = z.string().uuid();

/** El código impreso en la etiqueta: 12 caracteres sin ambiguos (sin 0/O, 1/I/L), en grupos de 4. */
export const ALFABETO_CODIGO_RECLAMO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Quita separadores y pasa a mayúsculas: lo que se hashea es siempre esta forma. */
export function normalizarCodigoReclamo(codigo: string): string {
  return codigo.replace(/[\s-]/g, "").toUpperCase();
}

export const usuarioApi = z.object({
  id: uuid,
  email: z.string(),
  nombre: z.string().nullable(),
  /** Administrador de plataforma (panel de etiquetas y boyas); no depende de ningún espacio. */
  es_admin: z.boolean().default(false),
});
export type UsuarioApi = z.infer<typeof usuarioApi>;

export const actualizarUsuarioBody = z
  .object({ nombre: z.string().trim().min(1).max(80) })
  .strict();

export const crearEspacioBody = z
  .object({ nombre: z.string().trim().min(1).max(80), tipo: tipoEspacio })
  .strict();

export const actualizarEspacioBody = z
  .object({
    nombre: z.string().trim().min(1).max(80).optional(),
    tipo: tipoEspacio.optional(),
    compartirZona: z.boolean().optional(),
    /** Precisión máxima ~colonia (RNF-08): hasta 6 caracteres. */
    zonaGeohash: z
      .string()
      .regex(/^[0-9b-hjkmnp-z]{1,6}$/)
      .nullable()
      .optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "sin cambios" });

export const espacioApi = z.object({
  id: uuid,
  nombre: z.string(),
  tipo: tipoEspacio,
  rol: rolEspacio,
  compartir_zona: z.boolean(),
  zona_geohash: z.string().nullable(),
  nodos: z.number().int(),
});
export type EspacioApi = z.infer<typeof espacioApi>;

export const miembroApi = z.object({
  usuario_id: uuid,
  nombre: z.string().nullable(),
  rol: rolEspacio,
  desde: z.string().datetime(),
});

export const estadoNodoApi = z.object({
  conectado: z.boolean(),
  cambio_conexion_en: z.string().datetime().nullable(),
  ultima_lectura_en: z.string().datetime().nullable(),
  nivel,
  wqi: z.number().nullable(),
  parametro_limitante: z.string().nullable(),
  confianza: z.enum(["ok", "dudosa", "revisar"]),
  /** Frase de causa y acción del estado (RF-20); nula hasta que el nodo tiene su primera evaluación. */
  causa: z.string().nullable(),
  accion: z.string().nullable(),
  ultimos_valores: z.record(z.string(), z.unknown()).nullable(),
});

export const nodoApi = z.object({
  id: uuid,
  espacio_id: uuid.nullable(),
  nombre: z.string().nullable(),
  perfil_id: z.string(),
  estado: estadoNodo,
  version_fw: z.string().nullable(),
  reclamado_en: z.string().datetime().nullable(),
  estado_actual: estadoNodoApi.nullable(),
  /** Última calibración y si ya venció; aditivo (los clientes anteriores lo ignoran). */
  calibracion: resumenCalibracion.optional(),
});
export type NodoApi = z.infer<typeof nodoApi>;

export const espacioDetalleApi = z.object({
  espacio: espacioApi,
  miembros: z.array(miembroApi),
  nodos: z.array(nodoApi),
});

export const crearInvitacionRespuesta = z.object({
  /** Se muestra una sola vez: en la base solo queda su hash. */
  token: z.string(),
  expira_en: z.string().datetime(),
});

export const aceptarInvitacionBody = z.object({ token: z.string().min(16).max(128) }).strict();
export const transferirBody = z.object({ usuarioId: uuid }).strict();

export const reclamarNodoBody = z
  .object({
    nodoId: uuid,
    codigo: z.string().min(8).max(32),
    espacioId: uuid,
    perfilId: z.string().min(1).max(32).default("cisterna"),
  })
  .strict();

export const actualizarNodoBody = z
  .object({
    nombre: z.string().trim().min(1).max(60).optional(),
    perfilId: z.string().min(1).max(32).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "sin cambios" });
