import type { Catalogo } from "../../dominio/catalogo.ts";
import { type Estado, evaluar, type Lectura } from "../evaluacion/index.ts";
import type { DetalleParametro, NodoDoc, UltimoNodo } from "../nodos/index.ts";
import {
  decidirCiclo,
  ESTADO_CICLO_INICIAL,
  type EstadoCiclo,
  type MuestraNueva,
} from "./ciclo.ts";
import type {
  AlmacenIngesta,
  CambioNodo,
  EventoIngesta,
  LectorNodo,
  LoggerIngesta,
  MuestraDoc,
} from "./puertos.ts";

const SILENCIO: LoggerIngesta = { info() {}, warn() {}, error() {} };

/** De mejor a peor: el estado general de un nodo es el peor de sus parámetros. */
const PRIORIDAD: Estado[] = ["en_rango", "atencion", "fuera_de_rango", "critico", "revisar_sensor"];

export function peorEstado(estados: Estado[]): Estado | null {
  let peor: Estado | null = null;
  for (const e of estados) {
    if (peor === null || PRIORIDAD.indexOf(e) > PRIORIDAD.indexOf(peor)) peor = e;
  }
  return peor;
}

type Operacion = { descripcion: string; ejecutar: () => Promise<void> };

type EstadoNodo = {
  ciclo: EstadoCiclo;
  ultimo: UltimoNodo | null;
  ventanas: Record<string, Lectura[]>;
  previo: Record<string, Estado>;
  /** Escrituras que fallaron (Mongo caído): se reintentan en orden en el siguiente ciclo. */
  pendientes: Operacion[];
};

export type OpcionesIngesta = {
  almacen: AlmacenIngesta;
  lector: LectorNodo;
  catalogo: Catalogo;
  sinDatosS: number;
  /** Minutos de lecturas que se conservan para evaluar. Debe cubrir la ventana de cambio rápido. */
  ventanaMin?: number;
  /** Máximo de escrituras en memoria si Mongo no responde. */
  maxPendientes?: number;
  /**
   * Se llama después de guardar cada muestra y cuando un nodo se da por detenido, con la misma cola
   * de reintentos que las demás escrituras: si falla, se repite sin perder el orden. Debe ser
   * idempotente (las alertas se reconcilian contra la foto del nodo, no cuentan eventos).
   */
  alCambio?: (cambio: CambioNodo) => Promise<void>;
  reloj?: () => Date;
  logger?: LoggerIngesta;
};

export type ResumenCiclo =
  | { tipo: "muestra"; estado: Estado | null; pendientes: number }
  | { tipo: "sin_cambio"; sinDatos: boolean; pendientes: number }
  | { tipo: "invalida"; pendientes: number };

export type Ingesta = ReturnType<typeof crearIngesta>;

export function crearIngesta(op: OpcionesIngesta) {
  const reloj = op.reloj ?? (() => new Date());
  const logger = op.logger ?? SILENCIO;
  const ventanaMs = (op.ventanaMin ?? 12) * 60_000;
  const maxPendientes = op.maxPendientes ?? 200;
  const estados = new Map<string, EstadoNodo>();

  async function cargar(nodo: NodoDoc): Promise<EstadoNodo> {
    const clave = nodo._id.toHexString();
    const existente = estados.get(clave);
    if (existente) return existente;

    // Se retoma desde lo último guardado: tras un reinicio del servidor no se duplica nada.
    const u = nodo.ultimo;
    const nuevo: EstadoNodo = {
      ciclo: u
        ? { seq: u.seq, sesion: u.sesion, ultimoCambio: u.ultimo_cambio, sinDatos: u.sin_datos }
        : { ...ESTADO_CICLO_INICIAL },
      ultimo: u,
      ventanas: {},
      previo: { ...(u?.estados ?? {}) },
      pendientes: [],
    };
    const desde = new Date(reloj().getTime() - ventanaMs);
    for (const m of await op.almacen.cargarVentana(nodo._id, desde)) {
      for (const [id, valor] of Object.entries(m.v)) {
        let ventana = nuevo.ventanas[id];
        if (!ventana) {
          ventana = [];
          nuevo.ventanas[id] = ventana;
        }
        ventana.push({ ts: m.ts, valor });
      }
    }
    estados.set(clave, nuevo);
    return nuevo;
  }

  function encolar(
    est: EstadoNodo,
    nodoId: string,
    descripcion: string,
    ejecutar: () => Promise<void>,
  ) {
    est.pendientes.push({ descripcion, ejecutar });
    while (est.pendientes.length > maxPendientes) {
      const perdida = est.pendientes.shift();
      logger.error(
        { nodo_id: nodoId, operacion: perdida?.descripcion },
        "búfer lleno: se descartó la escritura más antigua",
      );
    }
  }

  /** Ejecuta las escrituras en orden; se detiene en la primera que falle y las conserva. */
  async function vaciar(est: EstadoNodo, nodoId: string): Promise<void> {
    while (est.pendientes.length > 0) {
      const siguiente = est.pendientes[0] as Operacion;
      try {
        await siguiente.ejecutar();
        est.pendientes.shift();
      } catch {
        logger.warn(
          { nodo_id: nodoId, pendientes: est.pendientes.length, operacion: siguiente.descripcion },
          "no se pudo escribir en Mongo; se reintentará",
        );
        return;
      }
    }
  }

  /** Avisa a las alertas (después de guardar). Va por la misma cola, así que se reintenta en orden. */
  function avisarCambio(est: EstadoNodo, nodoId: string, cambio: CambioNodo) {
    const alCambio = op.alCambio;
    if (!alCambio) return;
    encolar(est, nodoId, "alertas", () => alCambio(cambio));
  }

  function evaluarParametros(nodo: NodoDoc, est: EstadoNodo, m: MuestraNueva) {
    const resultado: Record<string, Estado> = {};
    const detalles: Record<string, DetalleParametro> = {};
    let estable: boolean | null = null;
    for (const id of nodo.parametros) {
      const p = op.catalogo.parametros[id];
      const norma = nodo.umbrales?.[id] ?? p?.norma;
      if (!p?.medible || !p.reglas || !norma) continue;

      const valor = m.v[id];
      if (valor === undefined) {
        // El nodo publicó un `seq` nuevo pero sin valor para este parámetro: no es dato confiable.
        resultado[id] = "revisar_sensor";
        est.previo[id] = "revisar_sensor";
        detalles[id] = { cambio_rapido: false, cambio: null, motivos_sensor: ["sin_valor"] };
        estable = false;
        continue;
      }
      let ventana = est.ventanas[id];
      if (!ventana) {
        ventana = [];
        est.ventanas[id] = ventana;
      }
      ventana.push({ ts: m.ts, valor });
      const limite = m.ts.getTime() - ventanaMs;
      while (ventana.length > 0 && (ventana[0] as Lectura).ts.getTime() < limite) ventana.shift();

      const r = evaluar({
        norma: { min: norma.min, max: norma.max },
        reglas: p.reglas,
        ventana,
        previo: est.previo[id] ?? null,
        estadoNodo: m.estadoNodo,
      });
      resultado[id] = r.estado;
      est.previo[id] = r.estado;
      detalles[id] = {
        cambio_rapido: r.cambioRapido,
        cambio: r.cambio,
        motivos_sensor: r.motivosSensor,
      };
      estable = (estable ?? true) && r.estable;
    }
    return { estados: resultado, detalles, estable: estable ?? m.estableNodo };
  }

  /** Un sondeo de un nodo. Si Blynk falla, el error sube al poller (reintento con espera). */
  async function ciclo(nodo: NodoDoc): Promise<ResumenCiclo> {
    const id = nodo._id.toHexString();
    const est = await cargar(nodo);
    const snapshot = await op.lector.leer(nodo);
    const ahora = reloj();

    const r = decidirCiclo({
      estado: est.ciclo,
      snapshot,
      mapeo: nodo.blynk.mapeo,
      ahora,
      sinDatosS: op.sinDatosS,
    });
    est.ciclo = r.siguiente;

    if (r.tipo === "invalida") {
      logger.warn({ nodo_id: id, motivo: r.motivo }, "lectura de Blynk descartada");
      await vaciar(est, id);
      return { tipo: "invalida", pendientes: est.pendientes.length };
    }

    if (r.tipo === "sin_cambio") {
      if (r.evento === "sin_datos") {
        const evento: EventoIngesta = {
          nodo_id: nodo._id,
          comunidad_id: nodo.comunidad_id,
          ts: ahora,
          tipo: "sin_datos",
          severidad: "atencion",
          parametro: null,
          mensaje: "El nodo dejó de enviar datos.",
          datos: { silencio_s: Math.round(r.silencioS), ultimo_seq: est.ciclo.seq },
          autor_uid: null,
        };
        logger.warn({ nodo_id: id, silencio_s: Math.round(r.silencioS) }, "nodo sin datos");
        encolar(est, id, "evento sin_datos", () => op.almacen.registrarEvento(evento));
        if (est.ultimo) {
          est.ultimo = { ...est.ultimo, sin_datos: true };
          const ultimo = est.ultimo;
          encolar(est, id, "ultimo (sin datos)", () => op.almacen.guardarUltimo(nodo._id, ultimo));
          avisarCambio(est, id, { nodo, ultimo, ahora });
        }
      }
      await vaciar(est, id);
      return {
        tipo: "sin_cambio",
        sinDatos: est.ciclo.sinDatos,
        pendientes: est.pendientes.length,
      };
    }

    // Muestra nueva.
    const m = r.muestra;
    if (r.reinicio)
      logger.info({ nodo_id: id, sesion: m.sesion }, "el nodo se reinició (seq bajó)");
    const evaluado = evaluarParametros(nodo, est, m);
    const estado = peorEstado(Object.values(evaluado.estados));

    const doc: MuestraDoc = {
      nodo_id: nodo._id,
      ts: m.ts,
      seq: m.seq,
      sesion: m.sesion,
      v: m.v,
      crudo: m.crudo,
      estado,
      estados: evaluado.estados,
      detalles: evaluado.detalles,
      estable: evaluado.estable,
      estado_nodo: m.estadoNodo,
    };
    const ultimo: UltimoNodo = {
      ts: m.ts,
      v: m.v,
      estado,
      estados: evaluado.estados,
      detalles: evaluado.detalles,
      seq: m.seq,
      sesion: m.sesion,
      estable: evaluado.estable,
      ultimo_cambio: m.ts,
      sin_datos: false,
    };
    est.ultimo = ultimo;

    encolar(est, id, "muestra", async () => {
      const res = await op.almacen.insertarMuestra(doc);
      if (res === "duplicada")
        logger.warn({ nodo_id: id, seq: m.seq }, "muestra duplicada: se omite");
    });
    encolar(est, id, "ultimo", () => op.almacen.guardarUltimo(nodo._id, ultimo));
    if (r.evento === "reconexion") {
      const evento: EventoIngesta = {
        nodo_id: nodo._id,
        comunidad_id: nodo.comunidad_id,
        ts: ahora,
        tipo: "reconexion",
        severidad: "info",
        parametro: null,
        mensaje: "El nodo volvió a enviar datos.",
        datos: { seq: m.seq, sesion: m.sesion },
        autor_uid: null,
      };
      logger.info({ nodo_id: id }, "nodo reconectado");
      encolar(est, id, "evento reconexion", () => op.almacen.registrarEvento(evento));
    }
    avisarCambio(est, id, { nodo, ultimo, ahora });
    await vaciar(est, id);
    return { tipo: "muestra", estado, pendientes: est.pendientes.length };
  }

  return { ciclo };
}

export type OpcionesPoller = {
  ingesta: Ingesta;
  almacen: Pick<AlmacenIngesta, "listarNodos">;
  pollMs: number;
  /** Tope de la espera tras fallos seguidos de un nodo. */
  maxEsperaMs?: number;
  logger?: LoggerIngesta;
  /** Reloj en ms y espera: inyectables para las pruebas. */
  ahoraMs?: () => number;
  dormir?: (ms: number, senal: AbortSignal) => Promise<void>;
};

/** Espera exponencial tras `fallos` fallos seguidos, con tope. */
export function esperaTrasFallos(fallos: number, pollMs: number, maxMs = 60_000): number {
  return Math.min(maxMs, pollMs * 2 ** Math.min(fallos, 10));
}

const dormirReal = (ms: number, senal: AbortSignal) =>
  new Promise<void>((resolver) => {
    // Si ya se pidió detener, no se duerme: el aborto no volvería a avisar.
    if (senal.aborted) return resolver();
    const t = setTimeout(resolver, ms);
    senal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolver();
      },
      { once: true },
    );
  });

/** Sondea todos los nodos cada `pollMs`, de forma secuencial (nunca se solapan dos rondas). */
export function crearPoller(op: OpcionesPoller) {
  const logger = op.logger ?? SILENCIO;
  const ahoraMs = op.ahoraMs ?? Date.now;
  const dormir = op.dormir ?? dormirReal;
  const fallos = new Map<string, { n: number; hasta: number }>();
  let fallosLista = 0;
  const control = new AbortController();
  let bucle: Promise<void> | null = null;

  /** Una ronda sobre todos los nodos. Un nodo que falla no frena a los demás. */
  async function ronda(): Promise<void> {
    let nodos: NodoDoc[];
    try {
      nodos = await op.almacen.listarNodos();
      fallosLista = 0;
    } catch {
      fallosLista++;
      if (fallosLista === 1 || fallosLista % 10 === 0) {
        logger.warn({ intentos: fallosLista }, "no pude listar los nodos (¿Mongo caído?)");
      }
      return;
    }
    await Promise.all(
      nodos.map(async (nodo) => {
        const id = nodo._id.toHexString();
        const previo = fallos.get(id);
        if (previo && ahoraMs() < previo.hasta) return;
        try {
          await op.ingesta.ciclo(nodo);
          if (previo) {
            fallos.delete(id);
            logger.info({ nodo_id: id, fallos: previo.n }, "nodo recuperado");
          }
        } catch (e) {
          const n = (previo?.n ?? 0) + 1;
          fallos.set(id, { n, hasta: ahoraMs() + esperaTrasFallos(n, op.pollMs, op.maxEsperaMs) });
          if (n === 1 || n % 10 === 0) {
            logger.warn(
              { nodo_id: id, intentos: n, causa: e instanceof Error ? e.message : "error" },
              "no se pudo sondear el nodo",
            );
          }
        }
      }),
    );
  }

  return {
    ronda,
    iniciar() {
      if (bucle) return;
      bucle = (async () => {
        while (!control.signal.aborted) {
          await ronda();
          await dormir(op.pollMs, control.signal);
        }
      })();
    },
    async detener() {
      control.abort();
      await bucle;
    },
  };
}
