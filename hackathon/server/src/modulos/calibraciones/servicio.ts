import { ObjectId } from "mongodb";
import type { Catalogo } from "../../dominio/catalogo.ts";
import { SolicitudInvalida } from "../../dominio/errores.ts";
import { DIAGNOSTICO_CALIBRACION } from "../../dominio/frases.ts";
import {
  calibrar2Puntos,
  type DiagnosticoSonda,
  diagnosticarSonda,
  PARAMETROS_CALIBRABLES,
  pendienteNernst,
} from "../../dominio/ph.ts";
import type { NodoDoc, ServicioNodos } from "../nodos/index.ts";

/**
 * Registra la calibración de una sonda. Quien calibra es el firmware (con buffers); aquí queda el
 * registro y su diagnóstico para trazabilidad y para el reporte. **No** cambia nada en el nodo ni
 * convierte mV a pH en el servidor.
 */

export type CalibracionDoc = {
  _id: ObjectId;
  nodo_id: ObjectId;
  ts: Date;
  parametro: string;
  /** `usuario`: la registró una persona con sus dos puntos. `nodo`: la placa reportó su pendiente (V10) por Blynk. */
  origen?: "usuario" | "nodo";
  /** Nulo cuando la reportó el nodo: solo manda el porcentaje. */
  temp: number | null;
  puntos: { valor: number; mv: number }[];
  /** En las del nodo es una estimación a 25 °C a partir del porcentaje. */
  pendiente_mv_por_ph: number;
  pendiente_pct_nernst: number;
  /** Nulo cuando la reportó el nodo. */
  offset_mv: number | null;
  diagnostico: DiagnosticoSonda;
  /** Nulo cuando la reportó el nodo. */
  autor_uid: string | null;
};

export type EventoCalibracion = {
  nodo_id: ObjectId;
  comunidad_id: ObjectId;
  ts: Date;
  tipo: "calibracion";
  severidad: "info" | "atencion";
  parametro: string;
  mensaje: string;
  datos: { calibracion_id: string; diagnostico: DiagnosticoSonda; origen?: "usuario" | "nodo" };
  autor_uid: string | null;
};

export interface AlmacenCalibraciones {
  /** Guarda la calibración y luego su evento (el registro importa más que el aviso en la línea de tiempo). */
  registrar(calibracion: CalibracionDoc, evento: EventoCalibracion): Promise<void>;
  /** Las más recientes primero. */
  listar(nodoId: ObjectId, limite: number): Promise<CalibracionDoc[]>;
}

export type DatosCalibracion = {
  parametro: string;
  puntos: { valor: number; mv: number }[];
  tempC?: number | undefined;
};

export type OpcionesCalibraciones = {
  almacen: AlmacenCalibraciones;
  nodos: Pick<ServicioNodos, "acceso">;
  catalogo: Catalogo;
  reloj?: () => Date;
};

export const TEMP_CALIBRACION_DEFECTO_C = 25;
/** Cuánto debe cambiar la pendiente reportada por el nodo para guardarla como una calibración nueva. */
const CAMBIO_MIN_PCT = 0.5;
const MV_MAX = 2000;

const redondear = (n: number) => Math.round(n * 100) / 100;

export function crearServicioCalibraciones(op: OpcionesCalibraciones) {
  const reloj = op.reloj ?? (() => new Date());

  return {
    /** Solo el responsable calibra. El parámetro debe ser del nodo y de los que se calibran con buffers. */
    async registrar(uid: string, nodoId: ObjectId, d: DatosCalibracion): Promise<CalibracionDoc> {
      const { nodo } = await op.nodos.acceso(uid, nodoId, "responsable");
      const p = op.catalogo.parametros[d.parametro];
      if (
        !p ||
        !nodo.parametros.includes(d.parametro) ||
        !PARAMETROS_CALIBRABLES.includes(d.parametro)
      ) {
        throw new SolicitudInvalida(
          "parametro_no_calibrable",
          "Ese parámetro no se calibra en este nodo.",
        );
      }
      const [a, b] = d.puntos;
      if (d.puntos.length !== 2 || !a || !b) {
        throw new SolicitudInvalida(
          "puntos_invalidos",
          "Hacen falta exactamente dos puntos de calibración.",
        );
      }
      const fisicoMin = p.reglas?.fisico_min ?? Number.NEGATIVE_INFINITY;
      const fisicoMax = p.reglas?.fisico_max ?? Number.POSITIVE_INFINITY;
      for (const punto of d.puntos) {
        if (
          !Number.isFinite(punto.valor) ||
          !Number.isFinite(punto.mv) ||
          punto.valor < fisicoMin ||
          punto.valor > fisicoMax ||
          Math.abs(punto.mv) > MV_MAX
        ) {
          throw new SolicitudInvalida(
            "puntos_invalidos",
            "Los valores de los puntos no son posibles.",
          );
        }
      }
      if (a.valor === b.valor) {
        throw new SolicitudInvalida(
          "puntos_iguales",
          "Los dos puntos deben ser de buffers distintos.",
        );
      }
      const temp = d.tempC ?? TEMP_CALIBRACION_DEFECTO_C;
      if (!Number.isFinite(temp) || temp < 0 || temp > 50) {
        throw new SolicitudInvalida(
          "temperatura_invalida",
          "La temperatura debe estar entre 0 y 50 °C.",
        );
      }

      const cal = calibrar2Puntos({ ph: a.valor, mv: a.mv }, { ph: b.valor, mv: b.mv }, temp);
      const minimo = p.reglas?.sensor_pendiente_min_pct ?? 85;
      const buena = p.reglas?.sensor_pendiente_buena_pct ?? 95;
      const diagnostico = diagnosticarSonda(cal, minimo, buena);
      const ts = reloj();
      const doc: CalibracionDoc = {
        _id: new ObjectId(),
        nodo_id: nodo._id,
        ts,
        parametro: d.parametro,
        temp,
        puntos: d.puntos.map((x) => ({ valor: x.valor, mv: x.mv })),
        pendiente_mv_por_ph: redondear(cal.pendienteMvPorPh),
        pendiente_pct_nernst: redondear(cal.pendientePctNernst),
        offset_mv: redondear(cal.offsetMv),
        diagnostico,
        autor_uid: uid,
      };
      await op.almacen.registrar(doc, {
        nodo_id: nodo._id,
        comunidad_id: nodo.comunidad_id,
        ts,
        tipo: "calibracion",
        severidad: diagnostico === "buena" ? "info" : "atencion",
        parametro: d.parametro,
        mensaje: `Calibración de ${p.nombre} registrada: diagnóstico «${DIAGNOSTICO_CALIBRACION[diagnostico]}» (${doc.pendiente_pct_nernst.toFixed(1)} % de Nernst).`,
        datos: { calibracion_id: doc._id.toHexString(), diagnostico },
        autor_uid: uid,
      });
      return doc;
    },

    /**
     * Guarda la pendiente de la sonda que el nodo reportó por Blynk (V10), con su diagnóstico. No la dio una persona,
     * así que no hay puntos, offset ni temperatura: solo el porcentaje. Si la última calibración reportada por el nodo
     * ya tiene (casi) ese valor, no hace nada: reintentar o reiniciar el servidor no duplica registros.
     */
    async registrarReportada(
      nodo: NodoDoc,
      pctNernst: number,
      ts: Date,
    ): Promise<CalibracionDoc | null> {
      const parametro = "ph";
      const p = op.catalogo.parametros[parametro];
      if (!p || !nodo.parametros.includes(parametro)) return null;
      const [ultima] = await op.almacen.listar(nodo._id, 1);
      if (
        ultima?.origen === "nodo" &&
        Math.abs(ultima.pendiente_pct_nernst - pctNernst) < CAMBIO_MIN_PCT
      ) {
        return null;
      }
      const pendiente = -(pctNernst / 100) * pendienteNernst(TEMP_CALIBRACION_DEFECTO_C);
      const diagnostico = diagnosticarSonda(
        { pendienteMvPorPh: pendiente, pendientePctNernst: pctNernst },
        p.reglas?.sensor_pendiente_min_pct ?? 85,
        p.reglas?.sensor_pendiente_buena_pct ?? 95,
      );
      const doc: CalibracionDoc = {
        _id: new ObjectId(),
        nodo_id: nodo._id,
        ts,
        parametro,
        origen: "nodo",
        temp: null,
        puntos: [],
        pendiente_mv_por_ph: redondear(pendiente),
        pendiente_pct_nernst: redondear(pctNernst),
        offset_mv: null,
        diagnostico,
        autor_uid: null,
      };
      await op.almacen.registrar(doc, {
        nodo_id: nodo._id,
        comunidad_id: nodo.comunidad_id,
        ts,
        tipo: "calibracion",
        severidad: diagnostico === "buena" ? "info" : "atencion",
        parametro,
        mensaje: `La sonda de ${p.nombre} reportó su pendiente: ${doc.pendiente_pct_nernst.toFixed(1)} % de Nernst, diagnóstico «${DIAGNOSTICO_CALIBRACION[diagnostico]}».`,
        datos: { calibracion_id: doc._id.toHexString(), diagnostico, origen: "nodo" },
        autor_uid: null,
      });
      return doc;
    },

    async listar(uid: string, nodoId: ObjectId, limite = 20): Promise<CalibracionDoc[]> {
      const { nodo } = await op.nodos.acceso(uid, nodoId, "integrante");
      return op.almacen.listar(nodo._id, Math.min(Math.max(limite, 1), 100));
    },
  };
}

export type ServicioCalibraciones = ReturnType<typeof crearServicioCalibraciones>;
