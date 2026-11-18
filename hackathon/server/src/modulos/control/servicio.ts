import { ObjectId } from "mongodb";
import {
  Conflicto,
  NoEncontrado,
  ServicioNoDisponible,
  SolicitudInvalida,
} from "../../dominio/errores.ts";
import { textosActuador } from "../../dominio/frases.ts";
import type { CambioNodo } from "../ingesta/index.ts";
import type { ConfigActuador, NodoDoc, ServicioNodos } from "../nodos/index.ts";
import type {
  AccionDoc,
  AccionVista,
  AlmacenControl,
  Enclavamiento,
  EscritorActuador,
  EstadoAccion,
  LoggerControl,
} from "./puertos.ts";
import { bloqueos, duracionValida, motivoParaDetener, vistaDeAccion } from "./reglas.ts";

export type OpcionesControl = {
  almacen: AlmacenControl;
  escritor: EscritorActuador;
  nodos: Pick<ServicioNodos, "acceso">;
  reloj?: () => Date;
  logger?: LoggerControl;
};

/** Cuánto tiempo tiene una persona responsable para confirmar una solicitud. */
export const VIGENCIA_CONFIRMACION_S = 120;
export const PULSO_MAX_TOPE_S = 120;
export const ENFRIAMIENTO_MAX_S = 3600;

const SILENCIO: LoggerControl = { info() {}, warn() {}, error() {} };

export type DatosConfigActuador = {
  habilitado: boolean;
  nombre: string;
  pulso_max_s: number;
  enfriamiento_s: number;
  simulado: boolean;
  auto_detener: boolean;
};

export type EstadoControl = {
  actuador: ConfigActuador | null;
  activa: AccionVista | null;
  recientes: AccionVista[];
  bloqueos: Enclavamiento[];
  /** `true` si quien consulta es responsable y no hay nada que lo impida. */
  puede_solicitar: boolean;
};

const PIN = /^v\d{1,3}$/i;

export function crearControl(op: OpcionesControl) {
  const reloj = op.reloj ?? (() => new Date());
  const logger = op.logger ?? SILENCIO;

  /** Config con el pin tomado del mapeo del nodo: la gente nunca elige a qué pin se escribe. */
  const pinDe = (nodo: NodoDoc): string => {
    const pin = (nodo.blynk.mapeo.bomba ?? "v8").toLowerCase();
    if (!PIN.test(pin))
      throw new SolicitudInvalida("pin_invalido", "El pin del actuador no es válido.");
    return pin;
  };

  async function evento(
    nodo: NodoDoc,
    accion: AccionDoc,
    mensaje: string,
    severidad: "info" | "atencion",
    autor: string | null,
  ): Promise<void> {
    await op.almacen.registrarEvento({
      nodo_id: nodo._id,
      comunidad_id: nodo.comunidad_id,
      ts: reloj(),
      tipo: "actuador",
      severidad,
      parametro: null,
      mensaje,
      datos: { accion_id: accion._id.toHexString(), estado: accion.estado },
      autor_uid: autor,
    });
  }

  async function estadoDe(nodo: NodoDoc, esResponsable: boolean): Promise<EstadoControl> {
    const [activa, recientes, ultimoFin] = await Promise.all([
      op.almacen.activa(nodo._id),
      op.almacen.recientes(nodo._id, 10),
      op.almacen.ultimoFin(nodo._id),
    ]);
    const lista = bloqueos(nodo, activa, ultimoFin, reloj());
    return {
      actuador: nodo.actuador ?? null,
      activa: activa ? vistaDeAccion(activa) : null,
      recientes: recientes.map(vistaDeAccion),
      bloqueos: lista,
      puede_solicitar: esResponsable && lista.length === 0 && !activa,
    };
  }

  /** Apaga el relevador. Si no se puede, el error sube y la acción sigue «en curso» para reintentar. */
  async function apagar(nodo: NodoDoc): Promise<void> {
    await op.escritor.escribir(nodo, pinDe(nodo), 0);
  }

  async function cerrar(
    accion: AccionDoc,
    estado: EstadoAccion,
    cambios: Partial<Omit<AccionDoc, "_id">>,
  ): Promise<AccionDoc | null> {
    return op.almacen.transicion(accion._id, [accion.estado], { estado, ...cambios });
  }

  return {
    async estado(uid: string, nodoId: ObjectId): Promise<EstadoControl> {
      const { nodo, rol } = await op.nodos.acceso(uid, nodoId, "integrante");
      return estadoDe(nodo, rol === "responsable");
    },

    /** Habilita, ajusta o quita el actuador de un nodo. Solo el responsable. */
    async configurar(
      uid: string,
      nodoId: ObjectId,
      d: DatosConfigActuador,
    ): Promise<EstadoControl> {
      const { nodo } = await op.nodos.acceso(uid, nodoId, "responsable");
      const nombre = d.nombre.trim();
      if (nombre.length < 2 || nombre.length > 40) {
        throw new SolicitudInvalida(
          "nombre_invalido",
          "El nombre debe tener de 2 a 40 caracteres.",
        );
      }
      if (
        !Number.isInteger(d.pulso_max_s) ||
        d.pulso_max_s < 1 ||
        d.pulso_max_s > PULSO_MAX_TOPE_S
      ) {
        throw new SolicitudInvalida(
          "pulso_invalido",
          `El pulso máximo debe ser de 1 a ${PULSO_MAX_TOPE_S} segundos.`,
        );
      }
      if (
        !Number.isInteger(d.enfriamiento_s) ||
        d.enfriamiento_s < 0 ||
        d.enfriamiento_s > ENFRIAMIENTO_MAX_S
      ) {
        throw new SolicitudInvalida(
          "enfriamiento_invalido",
          `El enfriamiento debe ser de 0 a ${ENFRIAMIENTO_MAX_S} segundos.`,
        );
      }
      // No se puede apagar el control con un pulso en curso: primero se detiene.
      if (!d.habilitado && (await op.almacen.activa(nodo._id))) {
        throw new Conflicto(
          "accion_activa",
          "Hay un pulso pendiente o en curso: primero hay que detenerlo o cancelarlo.",
        );
      }
      const config: ConfigActuador = {
        habilitado: d.habilitado,
        nombre,
        pin: pinDe(nodo),
        pulso_max_s: d.pulso_max_s,
        enfriamiento_s: d.enfriamiento_s,
        simulado: d.simulado,
        auto_detener: d.auto_detener,
      };
      await op.almacen.guardarConfig(nodo._id, config);
      return estadoDe({ ...nodo, actuador: config }, true);
    },

    /** Pide un pulso: queda «pendiente» hasta que una persona responsable lo confirme. No manda nada a Blynk. */
    async solicitar(
      uid: string,
      nodoId: ObjectId,
      d: { duracionS: number; motivo?: string | undefined },
    ): Promise<AccionVista> {
      const { nodo } = await op.nodos.acceso(uid, nodoId, "responsable");
      const config = nodo.actuador;
      if (!config?.habilitado) {
        throw new SolicitudInvalida("sin_actuador", "Este nodo no tiene un actuador habilitado.");
      }
      if (!duracionValida(config, d.duracionS)) {
        throw new SolicitudInvalida(
          "duracion_invalida",
          `La duración debe ser de 1 a ${config.pulso_max_s} segundos.`,
        );
      }
      const motivo = d.motivo?.trim() || null;
      if (motivo && motivo.length > 200) {
        throw new SolicitudInvalida(
          "motivo_invalido",
          "El motivo puede tener hasta 200 caracteres.",
        );
      }
      const ahora = reloj();
      const lista = bloqueos(nodo, null, await op.almacen.ultimoFin(nodo._id), ahora);
      if (lista.length > 0) {
        throw new SolicitudInvalida("bloqueado", (lista[0] as Enclavamiento).mensaje);
      }
      const accion: AccionDoc = {
        _id: new ObjectId(),
        nodo_id: nodo._id,
        comunidad_id: nodo.comunidad_id,
        tipo: "pulso",
        duracion_s: d.duracionS,
        estado: "pendiente",
        solicitada: ahora,
        solicita_uid: uid,
        expira: new Date(ahora.getTime() + VIGENCIA_CONFIRMACION_S * 1000),
        motivo,
        confirmada: null,
        confirma_uid: null,
        inicio: null,
        fin: null,
        detalle: null,
        automatica: false,
        simulado: config.simulado,
      };
      if ((await op.almacen.insertar(accion)) === "ocupado") {
        throw new Conflicto("accion_activa", "Ya hay un pulso pendiente o en curso en este nodo.");
      }
      return vistaDeAccion(accion);
    },

    /**
     * Confirma un pulso: vuelve a mirar los enclavamientos (el agua pudo cambiar desde que se pidió) y, si
     * todo sigue bien, manda la orden a Blynk. Solo una confirmación gana, aunque lleguen dos a la vez.
     */
    async confirmar(uid: string, nodoId: ObjectId, accionId: ObjectId): Promise<AccionVista> {
      const { nodo } = await op.nodos.acceso(uid, nodoId, "responsable");
      const accion = await op.almacen.obtener(accionId, nodo._id);
      if (!accion) throw new NoEncontrado("No encontramos esa solicitud.");
      if (accion.estado !== "pendiente") {
        throw new Conflicto("solicitud_no_vigente", "Esa solicitud ya no está pendiente.");
      }
      const t = textosActuador({
        nombre: nodo.actuador?.nombre ?? "actuador",
        simulado: accion.simulado,
      });
      const ahora = reloj();

      if (accion.expira.getTime() <= ahora.getTime()) {
        const vencida = await cerrar(accion, "expirada", { detalle: t.expirada });
        if (vencida) await evento(nodo, vencida, t.expirada, "info", null);
        throw new Conflicto("solicitud_expirada", "La solicitud venció: pídela de nuevo.");
      }
      const config = nodo.actuador;
      // La acción pendiente es esta misma: no cuenta como «pulso en curso».
      const lista = config?.habilitado
        ? bloqueos(nodo, null, await op.almacen.ultimoFin(nodo._id), ahora)
        : bloqueos(nodo, null, null, ahora);
      if (lista.length > 0) {
        const mensaje = (lista[0] as Enclavamiento).mensaje;
        const rechazada = await cerrar(accion, "rechazada", { detalle: mensaje });
        if (rechazada) await evento(nodo, rechazada, t.rechazada(mensaje), "atencion", uid);
        throw new SolicitudInvalida("bloqueado", mensaje);
      }
      // Quien gana esta transición es el único que escribe en Blynk.
      const enCurso = await op.almacen.transicion(accion._id, ["pendiente"], {
        estado: "en_curso",
        confirmada: ahora,
        confirma_uid: uid,
        inicio: ahora,
        fin: new Date(ahora.getTime() + accion.duracion_s * 1000),
      });
      if (!enCurso)
        throw new Conflicto("solicitud_no_vigente", "Otra persona ya resolvió esa solicitud.");

      try {
        await op.escritor.escribir(nodo, pinDe(nodo), 1);
      } catch (e) {
        logger.warn(
          { nodo_id: nodo._id.toHexString(), causa: e instanceof Error ? e.message : "error" },
          "no se pudo mandar la orden de pulso",
        );
        const fallida = await cerrar(enCurso, "fallida", { detalle: t.fallida, fin: reloj() });
        if (fallida) await evento(nodo, fallida, t.fallida, "atencion", uid);
        throw new ServicioNoDisponible(
          "blynk_no_responde",
          "Blynk no recibió la orden. No se activó nada desde Atl.",
        );
      }
      await evento(nodo, enCurso, t.enviada(enCurso.duracion_s), "info", uid);
      logger.info(
        {
          nodo_id: nodo._id.toHexString(),
          accion_id: enCurso._id.toHexString(),
          duracion_s: enCurso.duracion_s,
        },
        "pulso enviado",
      );
      return vistaDeAccion(enCurso);
    },

    /** La persona dice «no, esperar»: la solicitud pendiente se cancela. */
    async cancelar(uid: string, nodoId: ObjectId, accionId: ObjectId): Promise<AccionVista> {
      const { nodo } = await op.nodos.acceso(uid, nodoId, "responsable");
      const accion = await op.almacen.obtener(accionId, nodo._id);
      if (!accion) throw new NoEncontrado("No encontramos esa solicitud.");
      const cancelada = await op.almacen.transicion(accion._id, ["pendiente"], {
        estado: "cancelada",
        detalle: textosActuador({ nombre: "", simulado: false }).cancelada,
      });
      if (!cancelada)
        throw new Conflicto("solicitud_no_vigente", "Esa solicitud ya no está pendiente.");
      await evento(
        nodo,
        cancelada,
        textosActuador({ nombre: "", simulado: false }).cancelada,
        "info",
        uid,
      );
      return vistaDeAccion(cancelada);
    },

    /**
     * Detiene ya: apaga el relevador. Se manda el 0 **antes** de marcar nada: si Blynk no responde, el pulso
     * sigue «en curso» y el barrido insiste; nunca se dice «detenido» sin haberlo mandado.
     */
    async detener(uid: string, nodoId: ObjectId): Promise<AccionVista | null> {
      const { nodo } = await op.nodos.acceso(uid, nodoId, "responsable");
      const activa = await op.almacen.activa(nodo._id);
      if (!activa) throw new Conflicto("sin_accion", "No hay ningún pulso en curso.");
      const t = textosActuador({
        nombre: nodo.actuador?.nombre ?? "actuador",
        simulado: activa.simulado,
      });
      if (activa.estado === "pendiente") {
        const c = await cerrar(activa, "cancelada", { detalle: t.cancelada });
        if (c) await evento(nodo, c, t.cancelada, "info", uid);
        return c ? vistaDeAccion(c) : null;
      }
      try {
        await apagar(nodo);
      } catch {
        throw new ServicioNoDisponible(
          "blynk_no_responde",
          "Blynk no recibió la orden de apagar. Inténtalo de nuevo ya.",
        );
      }
      const d = await cerrar(activa, "detenida", { fin: reloj(), detalle: t.detenidaPersona });
      if (d) await evento(nodo, d, t.detenidaPersona, "info", uid);
      return d ? vistaDeAccion(d) : null;
    },

    /**
     * Regla de seguridad: si hay un pulso en curso y el pH sale de rango, la sonda falla o el nodo deja de
     * enviar datos, se apaga. Lo llama la ingesta tras cada muestra; es idempotente (la transición es condicional).
     */
    async reaccionar(cambio: Pick<CambioNodo, "nodo" | "ultimo">): Promise<void> {
      const nodo: NodoDoc = { ...cambio.nodo, ultimo: cambio.ultimo };
      if (!nodo.actuador?.habilitado || !nodo.actuador.auto_detener) return;
      const activa = await op.almacen.activa(nodo._id);
      const motivo = motivoParaDetener(nodo, activa);
      if (!motivo || !activa) return;
      const t = textosActuador({ nombre: nodo.actuador.nombre, simulado: activa.simulado });
      try {
        await apagar(nodo);
      } catch (e) {
        // Se vuelve a intentar con la siguiente muestra; mientras tanto el firmware tiene su propio límite.
        logger.error(
          { nodo_id: nodo._id.toHexString(), causa: e instanceof Error ? e.message : "error" },
          "no se pudo detener el pulso por seguridad",
        );
        throw e;
      }
      const d = await cerrar(activa, "detenida", {
        fin: reloj(),
        detalle: t.detenidaAuto(motivo),
        automatica: true,
      });
      if (d) {
        await evento(nodo, d, t.detenidaAuto(motivo), "atencion", null);
        logger.warn(
          { nodo_id: nodo._id.toHexString(), accion_id: d._id.toHexString(), motivo },
          "pulso detenido por seguridad",
        );
      }
    },

    /** Periódico: vence las solicitudes sin confirmar y apaga los pulsos que llegaron a su fin. */
    async barrido(): Promise<void> {
      for (const accion of await op.almacen.vencidas(reloj())) {
        const nodo = await op.almacen.nodo(accion.nodo_id);
        if (!nodo) continue;
        const t = textosActuador({
          nombre: nodo.actuador?.nombre ?? "actuador",
          simulado: accion.simulado,
        });
        if (accion.estado === "pendiente") {
          const v = await cerrar(accion, "expirada", { detalle: t.expirada });
          if (v) await evento(nodo, v, t.expirada, "info", null);
          continue;
        }
        try {
          await apagar(nodo);
        } catch (e) {
          logger.error(
            { nodo_id: nodo._id.toHexString(), causa: e instanceof Error ? e.message : "error" },
            "no se pudo apagar al terminar el pulso; se reintenta",
          );
          continue;
        }
        const f = await cerrar(accion, "terminada", { detalle: null });
        if (f) await evento(nodo, f, t.terminada(f.duracion_s), "info", null);
      }
    },
  };
}

export type Control = ReturnType<typeof crearControl>;
