import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { type BdApp, conUsuario } from "../../platform/db.ts";
import type { Logger } from "../../platform/logger.ts";
import type { Redis } from "../../platform/valkey.ts";
import type {
  ActualizacionTelegram,
  ClienteTelegram,
  ManejadorActualizacion,
} from "../telegram/index.ts";

/**
 * Vinculación de Telegram por deep link (RF-26): la app genera un token de un solo uso (10 min, en Valkey) y
 * entrega `https://t.me/<bot>?start=<token>`. Al abrirlo, Telegram manda `/start <token>` al bot y el chat queda
 * vinculado a quien generó el token. El token es lo único que identifica al usuario: no se pide ni se muestra
 * ningún dato personal.
 */

const VIGENCIA_S = 600;
const prefijo = (token: string) => `tg:vincular:${token}`;

/** Un token por solicitud: 32 bytes aleatorios en base64url = 43 caracteres (Telegram admite 64 en `start`). */
export async function crearTokenVinculo(
  valkey: Redis,
  usuarioId: string,
): Promise<{ token: string; expiraEn: Date }> {
  const token = randomBytes(32).toString("base64url");
  await valkey.set(prefijo(token), usuarioId, "EX", VIGENCIA_S);
  return { token, expiraEn: new Date(Date.now() + VIGENCIA_S * 1000) };
}

export const enlaceDeVinculo = (bot: string, token: string): string =>
  `https://t.me/${bot}?start=${token}`;

const TEXTO = {
  ayuda:
    "Soy el bot de avisos de Lympha. Para recibir avisos, abre la app de Lympha, entra a Ajustes → Telegram y toca «Vincular».\n\nComandos: /desvincular deja de enviarte avisos.",
  vinculado:
    "✅ Listo, este chat quedó vinculado a tu cuenta de Lympha. Te avisaré aquí cuando cambie la calidad del agua de tus espacios, cuando un nodo se quede sin conexión y cuando haya que revisar un sensor.\n\nPuedes elegir qué niveles avisan y un horario silencioso en la app. /desvincular para dejar de recibir avisos.",
  vencido: "Este enlace venció o ya se usó. Genera uno nuevo desde la app de Lympha.",
  ocupado:
    "Este chat ya está vinculado a otra cuenta de Lympha. Envía /desvincular desde aquí y vuelve a generar el enlace.",
  soloPrivado: "Vincula desde una conversación privada conmigo, no desde un grupo.",
  desvinculado: "Listo, ya no te enviaré avisos. Puedes vincular de nuevo desde la app.",
  nadaQueDesvincular: "Este chat no estaba vinculado a ninguna cuenta.",
} as const;

const INICIO = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/i;
const DESVINCULAR = /^\/(?:desvincular|stop)(?:@\w+)?\s*$/i;
const TOKEN_VALIDO = /^[A-Za-z0-9_-]{16,64}$/;

export interface DepsManejador {
  bd: BdApp;
  valkey: Redis;
  cliente: Pick<ClienteTelegram, "enviarMensaje">;
  log: Logger;
}

/** Manejador de actualizaciones del bot: `/start <token>`, `/desvincular` y una ayuda para lo demás. */
export function crearManejadorTelegram(deps: DepsManejador): ManejadorActualizacion {
  const { bd, valkey, cliente, log } = deps;

  const responder = async (chatId: number, texto: string): Promise<void> => {
    try {
      await cliente.enviarMensaje(chatId, texto);
    } catch (error) {
      // Responder es cortesía: si falla, el vínculo (si lo hubo) ya quedó guardado.
      log.warn({ err: error }, "Telegram: no se pudo responder al usuario");
    }
  };

  async function vincular(chatId: number, token: string): Promise<string> {
    if (!TOKEN_VALIDO.test(token)) return TEXTO.vencido;
    // GETDEL: el token se consume al leerlo; dos aperturas simultáneas del mismo enlace no vinculan dos chats.
    const usuarioId = await valkey.getdel(prefijo(token));
    if (!usuarioId) return TEXTO.vencido;
    try {
      // `lympha_app` solo puede insertar y borrar vínculos (no actualizarlos): volver a vincular reemplaza el anterior.
      await conUsuario(bd, usuarioId, async (tx) => {
        await tx.execute(
          sql`DELETE FROM app.vinculos_telegram WHERE usuario_id = app.usuario_actual()`,
        );
        await tx.execute(
          sql`INSERT INTO app.vinculos_telegram (usuario_id, chat_id) VALUES (app.usuario_actual(), ${chatId})`,
        );
      });
    } catch (error) {
      // 23505 sobre chat_id: ese chat ya pertenece a otra cuenta. No se revela cuál.
      if (esViolacionDeUnicidad(error)) return TEXTO.ocupado;
      throw error;
    }
    log.info({ usuarioId }, "Telegram: chat vinculado");
    return TEXTO.vinculado;
  }

  async function desvincular(chatId: number): Promise<string> {
    const r = await bd.pool.query<{ ok: boolean }>("SELECT app.desvincular_chat($1) AS ok", [
      chatId,
    ]);
    return r.rows[0]?.ok ? TEXTO.desvinculado : TEXTO.nadaQueDesvincular;
  }

  return async (a: ActualizacionTelegram) => {
    const mensaje = a.message;
    const texto = mensaje?.text?.trim();
    if (!mensaje || !texto) return;
    const chatId = mensaje.chat.id;

    let respuesta: string;
    try {
      const inicio = INICIO.exec(texto);
      if (inicio) {
        if (mensaje.chat.type !== undefined && mensaje.chat.type !== "private") {
          respuesta = TEXTO.soloPrivado;
        } else {
          respuesta = inicio[1] ? await vincular(chatId, inicio[1]) : TEXTO.ayuda;
        }
      } else if (DESVINCULAR.test(texto)) {
        respuesta = await desvincular(chatId);
      } else {
        respuesta = TEXTO.ayuda;
      }
    } catch (error) {
      // Un fallo interno no debe tumbar el sondeo ni dejar al usuario sin respuesta.
      log.error({ err: error }, "Telegram: error al atender un mensaje");
      respuesta = "Hubo un problema de nuestro lado. Intenta de nuevo en unos minutos.";
    }
    await responder(chatId, respuesta);
  };
}

function esViolacionDeUnicidad(error: unknown): boolean {
  let actual: unknown = error;
  for (let i = 0; i < 5 && actual instanceof Error; i++) {
    if ((actual as { code?: unknown }).code === "23505") return true;
    actual = actual.cause;
  }
  return false;
}
