import { randomBytes } from "node:crypto";
import type { ObjectId } from "mongodb";
import type { Catalogo } from "../../dominio/catalogo.ts";
import {
  type EstadoLegible,
  type FilaEstado,
  textoEstado,
  textosBot,
} from "../../dominio/frases.ts";
import type { Marca } from "../../dominio/marca.ts";
import type { NodoDoc } from "../nodos/index.ts";

/**
 * Vinculación por enlace (patrón de Lympha): la app crea un token de un solo uso que vence en
 * 10 min y entrega `https://t.me/<bot>?start=<token>` (o `?startgroup=` para un grupo). Al abrirlo,
 * Telegram manda `/start <token>` al bot y ese chat queda vinculado a la comunidad: una comunidad =
 * un chat (normalmente un grupo, para que el aviso llegue a todas las familias).
 */

const VIGENCIA_MS = 10 * 60_000;
const TOKEN_VALIDO = /^[A-Za-z0-9_-]{16,64}$/;

export type ActualizacionBot = {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number; type?: string; title?: string };
    from?: { id: number };
  };
};

export type DatosChat = {
  chat_id: number;
  titulo: string | null;
  tipo: string;
  /** Id de Telegram de quien vinculó; solo esa persona puede desvincular. */
  vinculado_por: number | null;
};

export type ResultadoVinculo =
  | { resultado: "ok"; comunidad: string }
  | { resultado: "chat_ocupado" }
  | { resultado: "comunidad_inexistente" };

export interface AlmacenTelegram {
  guardarToken(t: { token: string; comunidad_id: ObjectId; expira: Date }): Promise<void>;
  /** Consume el token (un solo uso): devuelve la comunidad si existe y no venció. */
  canjearToken(token: string, ahora: Date): Promise<{ comunidad_id: ObjectId } | null>;
  vincularChat(comunidadId: ObjectId, chat: DatosChat, ahora: Date): Promise<ResultadoVinculo>;
  comunidadDeChat(
    chatId: number,
  ): Promise<{ _id: ObjectId; nombre: string; vinculado_por: number | null } | null>;
  desvincularChat(chatId: number): Promise<boolean>;
  nodosDeComunidad(comunidadId: ObjectId): Promise<NodoDoc[]>;
}

export interface ResponderBot {
  enviarMensaje(chatId: number, texto: string): Promise<void>;
}

export type LoggerTelegram = {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
};

/** 32 bytes aleatorios en base64url = 43 caracteres (Telegram admite hasta 64 en `start`). */
export async function crearTokenVinculo(
  almacen: Pick<AlmacenTelegram, "guardarToken">,
  comunidadId: ObjectId,
  ahora: Date = new Date(),
): Promise<{ token: string; expiraEn: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiraEn = new Date(ahora.getTime() + VIGENCIA_MS);
  await almacen.guardarToken({ token, comunidad_id: comunidadId, expira: expiraEn });
  return { token, expiraEn };
}

export function enlaceDeVinculo(usuarioBot: string, token: string, grupo = false): string {
  return `https://t.me/${usuarioBot}?${grupo ? "startgroup" : "start"}=${token}`;
}

export type OpcionesManejador = {
  almacen: AlmacenTelegram;
  cliente: ResponderBot;
  marca: Marca;
  catalogo: Catalogo;
  /** Usuario del bot (sin @): para ignorar `/estado@otro_bot` en grupos. */
  usuarioBot?: string;
  reloj?: () => Date;
  logger?: LoggerTelegram;
};

const INICIO = /^\/start(?:@(\w+))?(?:\s+(\S+))?\s*$/i;
const ESTADO = /^\/estado(?:@(\w+))?\s*$/i;
const AYUDA = /^\/(?:ayuda|help)(?:@(\w+))?\s*$/i;
const DESVINCULAR = /^\/(?:desvincular|stop)(?:@(\w+))?\s*$/i;

/** Manejador de actualizaciones del bot: `/start <token>`, `/estado`, `/ayuda` y `/desvincular`. */
export function crearManejadorTelegram(op: OpcionesManejador) {
  const reloj = op.reloj ?? (() => new Date());
  const logger = op.logger ?? { info() {}, warn() {}, error() {} };
  const T = textosBot(op.marca);

  const aMi = (sufijo: string | undefined): boolean =>
    !sufijo || !op.usuarioBot || sufijo.toLowerCase() === op.usuarioBot.toLowerCase();

  async function responder(chatId: number, texto: string): Promise<void> {
    try {
      await op.cliente.enviarMensaje(chatId, texto);
    } catch (e) {
      // Responder es cortesía: si falla, lo que ya se guardó (p. ej. el vínculo) queda guardado.
      logger.warn(
        { causa: e instanceof Error ? e.message : "error" },
        "Telegram: no se pudo responder",
      );
    }
  }

  async function vincular(
    token: string,
    chat: { id: number; type?: string; title?: string },
    desde: number | null,
  ): Promise<string> {
    if (!TOKEN_VALIDO.test(token)) return T.vencido;
    const ahora = reloj();
    const canje = await op.almacen.canjearToken(token, ahora);
    if (!canje) return T.vencido;
    const r = await op.almacen.vincularChat(
      canje.comunidad_id,
      {
        chat_id: chat.id,
        titulo: chat.title ?? null,
        tipo: chat.type ?? "private",
        vinculado_por: desde,
      },
      ahora,
    );
    if (r.resultado === "chat_ocupado") return T.ocupado;
    if (r.resultado === "comunidad_inexistente") return T.comunidadInexistente;
    logger.info({ chat_tipo: chat.type ?? "private" }, "Telegram: chat vinculado");
    return T.vinculado(r.comunidad);
  }

  async function estado(chatId: number): Promise<string> {
    const comunidad = await op.almacen.comunidadDeChat(chatId);
    if (!comunidad) return T.noVinculado;
    const ahora = reloj();
    const nodos = await op.almacen.nodosDeComunidad(comunidad._id);
    const filas: FilaEstado[] = nodos.map((n) => {
      const u = n.ultimo;
      if (!u) return { nodo: n.nombre, estado: null, lectura: null, haceS: null };
      const lectura = Object.entries(u.v)
        .map(([id, valor]) => {
          const p = op.catalogo.parametros[id];
          return `${p?.nombre ?? id} ${valor.toFixed(p?.decimales ?? 2)}${p?.unidad ? ` ${p.unidad}` : ""}`;
        })
        .join(" · ");
      return {
        nodo: n.nombre,
        estado: (u.sin_datos ? "sin_conexion" : u.estado) as EstadoLegible | null,
        lectura: lectura || null,
        haceS: (ahora.getTime() - u.ts.getTime()) / 1000,
      };
    });
    return textoEstado(comunidad.nombre, filas, op.marca);
  }

  async function desvincular(chatId: number, desde: number | null): Promise<string> {
    const comunidad = await op.almacen.comunidadDeChat(chatId);
    if (!comunidad) return T.nadaQueDesvincular;
    if (comunidad.vinculado_por !== null && comunidad.vinculado_por !== desde) {
      return T.soloQuienVinculo;
    }
    return (await op.almacen.desvincularChat(chatId)) ? T.desvinculado : T.nadaQueDesvincular;
  }

  return async (a: ActualizacionBot): Promise<void> => {
    const mensaje = a.message;
    const texto = mensaje?.text?.trim();
    if (!mensaje || !texto?.startsWith("/")) return;
    const chat = mensaje.chat;
    const desde = mensaje.from?.id ?? null;
    const privado = chat.type === undefined || chat.type === "private";

    let respuesta: string | null;
    try {
      const inicio = INICIO.exec(texto);
      if (inicio) {
        if (!aMi(inicio[1])) return;
        respuesta = inicio[2] ? await vincular(inicio[2], chat, desde) : T.ayuda;
      } else if (ESTADO.test(texto)) {
        if (!aMi(ESTADO.exec(texto)?.[1])) return;
        respuesta = await estado(chat.id);
      } else if (AYUDA.test(texto)) {
        if (!aMi(AYUDA.exec(texto)?.[1])) return;
        respuesta = T.ayuda;
      } else if (DESVINCULAR.test(texto)) {
        if (!aMi(DESVINCULAR.exec(texto)?.[1])) return;
        respuesta = await desvincular(chat.id, desde);
      } else {
        // Un comando que no conocemos: se responde con la ayuda solo en privado, para no ensuciar un grupo.
        respuesta = privado ? T.ayuda : null;
      }
    } catch (e) {
      // Un fallo interno no debe tumbar el sondeo ni dejar al usuario sin respuesta.
      logger.error(
        { causa: e instanceof Error ? e.message : "error" },
        "Telegram: error al atender un mensaje",
      );
      respuesta = T.errorInterno;
    }
    if (respuesta !== null) await responder(chat.id, respuesta);
  };
}
