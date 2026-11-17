import { ObjectId } from "mongodb";
import { parametroDe } from "../dominio/catalogo.ts";
import type {
  AlertaDoc,
  AlmacenAlertas,
  EventoAlerta,
  SeveridadAlerta,
} from "../modulos/alertas/index.ts";
import type {
  AlmacenIngesta,
  EventoIngesta,
  LectorNodo,
  MuestraDoc,
  ResultadoInsercion,
  Snapshot,
} from "../modulos/ingesta/index.ts";
import { crearDocumentoNodo, type NodoDoc, type UltimoNodo } from "../modulos/nodos/index.ts";
import type { AlmacenAvisos, AvisoDoc } from "../modulos/notificaciones/index.ts";
import type { AlmacenTelegram, DatosChat, ResultadoVinculo } from "../modulos/telegram/index.ts";
import { cargarCatalogo } from "../plataforma/catalogo.ts";
import { muestra, type NombreEscenario } from "../simulador/escenarios.ts";

/** Dobles de prueba compartidos: una «base de datos» en memoria y un nodo simulado. Solo para pruebas. */

export const catalogoDePrueba = cargarCatalogo();
const normaPh = parametroDe(catalogoDePrueba, "ph").norma;
if (!normaPh || normaPh.min === null || normaPh.max === null) throw new Error("catálogo sin norma");
export const normaDePrueba = { min: normaPh.min, max: normaPh.max };

export const T0 = Date.UTC(2026, 10, 19, 15, 0, 0);

export type ComunidadFalsa = {
  _id: ObjectId;
  nombre: string;
  telegram: (DatosChat & { vinculado: Date }) | null;
};

export function nodoDePrueba(
  comunidadId: ObjectId = new ObjectId(),
  nombre = "Tinaco azotea",
): NodoDoc {
  return crearDocumentoNodo({
    comunidadId,
    nombre,
    tokenCifrado: "v1:x:y:z",
    host: "blynk.cloud",
    catalogo: catalogoDePrueba,
    ahora: new Date(T0),
  });
}

/**
 * Mongo en memoria con las mismas garantías que los índices reales: muestra única por
 * (nodo, sesión, seq), una alerta abierta por (nodo, tipo, parámetro), aviso único por clave y
 * un chat de Telegram por comunidad. `caido = true` hace que toda operación falle.
 */
export class BaseFalsa implements AlmacenIngesta, AlmacenAlertas, AlmacenAvisos, AlmacenTelegram {
  nodos: NodoDoc[] = [];
  comunidades = new Map<string, ComunidadFalsa>();
  muestras: MuestraDoc[] = [];
  eventos: (EventoIngesta | EventoAlerta)[] = [];
  ultimos = new Map<string, UltimoNodo>();
  alertas: AlertaDoc[] = [];
  avisos: AvisoDoc[] = [];
  tokens: { token: string; comunidad_id: ObjectId; expira: Date }[] = [];
  caido = false;

  private revisar() {
    if (this.caido) throw new Error("Mongo caído");
  }

  /** Registra un nodo (y su comunidad, si no existe) y devuelve el nodo. */
  agregarNodo(nodo: NodoDoc, nombreComunidad = "Primaria X"): NodoDoc {
    this.nodos.push(nodo);
    if (!this.comunidades.has(nodo.comunidad_id.toHexString())) {
      this.comunidades.set(nodo.comunidad_id.toHexString(), {
        _id: nodo.comunidad_id,
        nombre: nombreComunidad,
        telegram: null,
      });
    }
    return nodo;
  }

  vincularFalso(comunidadId: ObjectId, chatId = 555, vinculadoPor: number | null = 42) {
    const c = this.comunidades.get(comunidadId.toHexString());
    if (!c) throw new Error("comunidad inexistente");
    c.telegram = {
      chat_id: chatId,
      titulo: "Padres",
      tipo: "group",
      vinculado_por: vinculadoPor,
      vinculado: new Date(T0),
    };
  }

  private conUltimo(n: NodoDoc): NodoDoc {
    return { ...n, ultimo: this.ultimos.get(n._id.toHexString()) ?? n.ultimo };
  }

  /* ---- AlmacenIngesta ---- */
  async listarNodos() {
    this.revisar();
    return this.nodos.map((n) => this.conUltimo(n));
  }
  async cargarVentana(id: ObjectId, desde: Date) {
    this.revisar();
    return this.muestras
      .filter((m) => m.nodo_id.equals(id) && m.ts >= desde)
      .map((m) => ({ ts: m.ts, v: m.v }));
  }
  async insertarMuestra(m: MuestraDoc): Promise<ResultadoInsercion> {
    this.revisar();
    const dup = this.muestras.some(
      (x) => x.nodo_id.equals(m.nodo_id) && x.sesion === m.sesion && x.seq === m.seq,
    );
    if (dup) return "duplicada";
    this.muestras.push(m);
    return "insertada";
  }
  async guardarUltimo(id: ObjectId, u: UltimoNodo) {
    this.revisar();
    this.ultimos.set(id.toHexString(), u);
  }
  async registrarEvento(e: EventoIngesta | EventoAlerta) {
    this.revisar();
    this.eventos.push(e);
  }

  /* ---- AlmacenAlertas ---- */
  async alertasAbiertasDeNodo(nodoId: ObjectId) {
    this.revisar();
    return this.alertas
      .filter((a) => a.estado === "abierta" && a.nodo_id.equals(nodoId))
      .map((a) => ({ ...a }));
  }
  async alertasAbiertas() {
    this.revisar();
    return this.alertas.filter((a) => a.estado === "abierta").map((a) => ({ ...a }));
  }
  async nodo(id: ObjectId) {
    this.revisar();
    const n = this.nodos.find((x) => x._id.equals(id));
    return n ? this.conUltimo(n) : null;
  }
  async hayChat(comunidadId: ObjectId) {
    this.revisar();
    return this.comunidades.get(comunidadId.toHexString())?.telegram != null;
  }
  async insertarAlerta(alerta: AlertaDoc) {
    this.revisar();
    const dup = this.alertas.some(
      (a) =>
        a.estado === "abierta" &&
        a.nodo_id.equals(alerta.nodo_id) &&
        a.tipo === alerta.tipo &&
        a.parametro === alerta.parametro,
    );
    if (dup) return "duplicada" as const;
    this.alertas.push({ ...alerta });
    return "insertada" as const;
  }
  async cerrarAlerta(id: ObjectId, ts: Date, valor: number | null) {
    this.revisar();
    const a = this.alertas.find((x) => x._id.equals(id) && x.estado === "abierta");
    if (!a) return false;
    a.estado = "cerrada";
    a.cerrada = ts;
    a.valor_cierre = valor;
    return true;
  }
  async cambiarSeveridad(
    id: ObjectId,
    desde: SeveridadAlerta,
    a: SeveridadAlerta,
    maxima: SeveridadAlerta,
  ) {
    this.revisar();
    const x = this.alertas.find(
      (y) => y._id.equals(id) && y.estado === "abierta" && y.severidad === desde,
    );
    if (!x) return false;
    x.severidad = a;
    x.severidad_maxima = maxima;
    return true;
  }
  async marcarAviso(id: ObjectId, ts: Date, recordatorios?: number) {
    this.revisar();
    const a = this.alertas.find((x) => x._id.equals(id));
    if (!a) return;
    a.ultimo_aviso = ts;
    if (recordatorios !== undefined) a.recordatorios = recordatorios;
  }
  async encolarAviso(aviso: AvisoDoc) {
    this.revisar();
    if (this.avisos.some((a) => a.clave === aviso.clave)) return "duplicado" as const;
    this.avisos.push({ ...aviso });
    return "encolado" as const;
  }

  /* ---- AlmacenAvisos ---- */
  async tomarSiguiente(ahora: Date, arriendoMs: number) {
    this.revisar();
    const a = this.avisos
      .filter(
        (x) =>
          x.estado === "pendiente" &&
          x.proximo_intento <= ahora &&
          (x.bloqueado_hasta === null || x.bloqueado_hasta < ahora),
      )
      .sort((p, q) => p.creado.getTime() - q.creado.getTime())[0];
    if (!a) return null;
    a.bloqueado_hasta = new Date(ahora.getTime() + arriendoMs);
    return { ...a };
  }
  private aviso(id: ObjectId) {
    const a = this.avisos.find((x) => x._id.equals(id));
    if (!a) throw new Error("aviso inexistente");
    return a;
  }
  async marcarEnviado(id: ObjectId, ahora: Date) {
    this.revisar();
    const a = this.aviso(id);
    a.estado = "enviado";
    a.enviado = ahora;
    a.bloqueado_hasta = null;
    a.intentos++;
  }
  async reprogramar(id: ObjectId, proximo: Date, error: string) {
    this.revisar();
    const a = this.aviso(id);
    a.proximo_intento = proximo;
    a.ultimo_error = error;
    a.bloqueado_hasta = null;
    a.intentos++;
  }
  async marcarFallido(id: ObjectId, error: string) {
    this.revisar();
    const a = this.aviso(id);
    a.estado = "fallido";
    a.ultimo_error = error;
    a.bloqueado_hasta = null;
    a.intentos++;
  }
  async chatDe(comunidadId: ObjectId) {
    this.revisar();
    return this.comunidades.get(comunidadId.toHexString())?.telegram?.chat_id ?? null;
  }

  /* ---- AlmacenTelegram ---- */
  async guardarToken(t: { token: string; comunidad_id: ObjectId; expira: Date }) {
    this.revisar();
    this.tokens.push(t);
  }
  async canjearToken(token: string, ahora: Date) {
    this.revisar();
    const i = this.tokens.findIndex((t) => t.token === token && t.expira > ahora);
    if (i < 0) return null;
    const [t] = this.tokens.splice(i, 1);
    return t ? { comunidad_id: t.comunidad_id } : null;
  }
  async vincularChat(
    comunidadId: ObjectId,
    chat: DatosChat,
    ahora: Date,
  ): Promise<ResultadoVinculo> {
    this.revisar();
    const c = this.comunidades.get(comunidadId.toHexString());
    if (!c) return { resultado: "comunidad_inexistente" };
    const ocupado = [...this.comunidades.values()].some(
      (x) => !x._id.equals(comunidadId) && x.telegram?.chat_id === chat.chat_id,
    );
    if (ocupado) return { resultado: "chat_ocupado" };
    c.telegram = { ...chat, vinculado: ahora };
    return { resultado: "ok", comunidad: c.nombre };
  }
  async comunidadDeChat(chatId: number) {
    this.revisar();
    const c = [...this.comunidades.values()].find((x) => x.telegram?.chat_id === chatId);
    return c
      ? { _id: c._id, nombre: c.nombre, vinculado_por: c.telegram?.vinculado_por ?? null }
      : null;
  }
  async desvincularChat(chatId: number) {
    this.revisar();
    const c = [...this.comunidades.values()].find((x) => x.telegram?.chat_id === chatId);
    if (!c) return false;
    c.telegram = null;
    return true;
  }
  async nodosDeComunidad(comunidadId: ObjectId) {
    this.revisar();
    return this.nodos
      .filter((n) => n.comunidad_id.equals(comunidadId))
      .map((n) => this.conUltimo(n));
  }
}

const redondear = (n: number) => Number(n.toFixed(2));

/** Un nodo simulado que escribe en «Blynk» exactamente como `pnpm simulador`. */
export function lectorDeEscenario(nombre: NombreEscenario, reloj: () => Date): LectorNodo {
  let seq = 0;
  let ultima: Snapshot = {};
  return {
    async leer() {
      const t = (reloj().getTime() - T0) / 1000;
      const m = muestra(nombre, t, normaDePrueba);
      if (m.escribe) {
        seq++;
        ultima = {
          v2: redondear(m.ph),
          v7: redondear(m.phCrudo),
          v4: m.estado,
          v5: m.estable ? 1 : 0,
          v6: seq,
        };
      }
      return { ...ultima };
    },
  };
}

/** Registro de logs para las pruebas. */
export function loggerDePrueba() {
  const logs = { info: [] as object[], warn: [] as object[], error: [] as object[] };
  return {
    logs,
    logger: {
      info: (o: object) => void logs.info.push(o),
      warn: (o: object) => void logs.warn.push(o),
      error: (o: object) => void logs.error.push(o),
    },
  };
}
