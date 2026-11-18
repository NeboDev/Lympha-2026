import { z } from "zod";

/**
 * Lo que la API de Atl devuelve, validado con zod: si el servidor cambia de forma, la web lo dice en vez
 * de mostrar datos a medias. Las fechas llegan como texto ISO y aquí se vuelven `Date`.
 */

const fecha = z.coerce.date();

export const ESTADOS = [
  "en_rango",
  "atencion",
  "fuera_de_rango",
  "critico",
  "revisar_sensor",
] as const;
export type EstadoAgua = (typeof ESTADOS)[number];

export const rol = z.enum(["responsable", "integrante"]);
export type Rol = z.infer<typeof rol>;

export const comunidad = z.object({
  id: z.string(),
  nombre: z.string(),
  tipo: z.enum(["escuela", "comite", "hogar", "otro"]),
  rol,
  telegram: z.object({ vinculado: z.literal(true), titulo: z.string().nullable() }).nullable(),
  creado: fecha,
});
export type Comunidad = z.infer<typeof comunidad>;

export const respuestaYo = z.object({
  usuario: z.object({
    id: z.string(),
    nombre: z.string().nullable(),
    correo: z.string(),
    demo: z.boolean(),
  }),
  comunidades: z.array(comunidad),
});
export type RespuestaYo = z.infer<typeof respuestaYo>;

export const parametro = z.object({
  id: z.string(),
  nombre: z.string(),
  unidad: z.string(),
  decimales: z.number().int(),
  norma: z
    .object({ min: z.number().nullable(), max: z.number().nullable(), fuente: z.string() })
    .nullable(),
});
export type Parametro = z.infer<typeof parametro>;

export const nodo = z.object({
  id: z.string(),
  comunidad_id: z.string(),
  nombre: z.string(),
  ubicacion: z
    .object({ texto: z.string(), lat: z.number().optional(), lng: z.number().optional() })
    .nullable(),
  parametros: z.array(parametro),
  /** `sin_lecturas`: aún no llega ninguna · `sin_datos`: dejó de enviar · `conectado`: envía datos. */
  conexion: z.enum(["sin_lecturas", "conectado", "sin_datos"]),
  ultimo: z
    .object({
      ts: fecha,
      v: z.record(z.number()),
      estado: z.enum(ESTADOS).nullable(),
      estados: z.record(z.enum(ESTADOS)),
      estable: z.boolean().nullable(),
      sin_datos: z.boolean(),
    })
    .nullable(),
  /** El actuador del nodo (resumen), o `null`. El detalle y los controles salen de `/actuador`. */
  actuador: z
    .object({ habilitado: z.boolean(), nombre: z.string(), simulado: z.boolean() })
    .nullable(),
  rol,
  creado: fecha,
});
export type Nodo = z.infer<typeof nodo>;

export const listaNodos = z.object({ nodos: z.array(nodo) });
export const altaNodo = nodo.extend({ conectado: z.boolean() });
export type AltaNodo = z.infer<typeof altaNodo>;

export const serie = z.object({
  desde: fecha,
  hasta: fecha,
  paso_s: z.number(),
  parametros: z.array(z.string()),
  puntos: z.array(
    z.object({
      ts: fecha,
      n: z.number(),
      v: z.record(z.object({ prom: z.number(), min: z.number(), max: z.number() })),
    }),
  ),
});
export type Serie = z.infer<typeof serie>;

export const alerta = z.object({
  id: z.string(),
  tipo: z.enum(["nivel", "cambio_rapido", "sensor", "sin_conexion"]),
  parametro: z.string().nullable(),
  severidad: z.enum(["atencion", "alta", "critica"]),
  severidad_maxima: z.enum(["atencion", "alta", "critica"]),
  estado: z.enum(["abierta", "cerrada"]),
  abierta: fecha,
  cerrada: fecha.nullable(),
  valor_apertura: z.number().nullable(),
  valor_cierre: z.number().nullable(),
  titulo: z.string(),
  detalle: z.string(),
});
export type Alerta = z.infer<typeof alerta>;

export const eventoNodo = z.object({
  ts: fecha,
  tipo: z.enum(["sin_datos", "reconexion", "bitacora", "calibracion", "actuador"]),
  mensaje: z.string(),
  propia: z.boolean(),
});
export type EventoNodo = z.infer<typeof eventoNodo>;

export const eventos = z.object({
  desde: fecha,
  hasta: fecha,
  alertas: z.array(alerta),
  eventos: z.array(eventoNodo),
});
export type Eventos = z.infer<typeof eventos>;

export const calibracion = z.object({
  id: z.string(),
  ts: fecha,
  parametro: z.string(),
  temp_c: z.number(),
  puntos: z.array(z.object({ valor: z.number(), mv: z.number() })),
  pendiente_mv_por_ph: z.number(),
  pendiente_pct_nernst: z.number(),
  offset_mv: z.number(),
  diagnostico: z.enum(["buena", "desgastada", "revisar"]),
});
export type Calibracion = z.infer<typeof calibracion>;
export const listaCalibraciones = z.object({ calibraciones: z.array(calibracion) });

export const reporte = z.object({
  id: z.string(),
  desde: fecha,
  hasta: fecha,
  generado: fecha,
  generado_por: z.string(),
  huella: z.string(),
  resumen: z.object({
    parametros: z.record(
      z.object({
        prom: z.number().nullable(),
        min: z.number().nullable(),
        max: z.number().nullable(),
        pct_en_rango: z.number().nullable(),
        n: z.number(),
      }),
    ),
    cobertura_pct: z.number(),
    alertas: z.number(),
  }),
});
export type Reporte = z.infer<typeof reporte>;
export const listaReportes = z.object({ reportes: z.array(reporte) });

export const nota = z.object({ ts: fecha, texto: z.string() });
export const enlaceTelegram = z.object({ enlace: z.string().url(), expira: fecha });
export type EnlaceTelegram = z.infer<typeof enlaceTelegram>;

/** Cuerpo de error de la API. */
export const cuerpoError = z.object({ error: z.string(), mensaje: z.string().optional() });

/* ---- Actuador (pulsos con confirmación) ---- */

export const ESTADOS_ACCION = [
  "pendiente",
  "en_curso",
  "terminada",
  "detenida",
  "cancelada",
  "expirada",
  "rechazada",
  "fallida",
] as const;
export type EstadoAccion = (typeof ESTADOS_ACCION)[number];

export const accion = z.object({
  id: z.string(),
  estado: z.enum(ESTADOS_ACCION),
  duracion_s: z.number(),
  solicitada: fecha,
  expira: fecha,
  inicio: fecha.nullable(),
  fin: fecha.nullable(),
  motivo: z.string().nullable(),
  detalle: z.string().nullable(),
  automatica: z.boolean(),
  simulado: z.boolean(),
});
export type Accion = z.infer<typeof accion>;

export const configActuador = z.object({
  habilitado: z.boolean(),
  nombre: z.string(),
  pin: z.string(),
  pulso_max_s: z.number(),
  enfriamiento_s: z.number(),
  simulado: z.boolean(),
  auto_detener: z.boolean(),
});
export type ConfigActuador = z.infer<typeof configActuador>;

export const estadoControl = z.object({
  actuador: configActuador.nullable(),
  activa: accion.nullable(),
  recientes: z.array(accion),
  bloqueos: z.array(z.object({ codigo: z.string(), mensaje: z.string() })),
  puede_solicitar: z.boolean(),
});
export type EstadoControl = z.infer<typeof estadoControl>;

export const respuestaDetener = z.object({ accion: accion.nullable() });
