import { z } from "zod";
import { type BdSistema, conSistema } from "../../platform/db.ts";
import type { Logger } from "../../platform/logger.ts";
import { ErrorTelegram } from "../telegram/index.ts";
import {
  ARRENDAMIENTO_S,
  cerrarSinEnviar,
  type FilaSalida,
  marcarEnviada,
  olvidarVinculo,
  reclamarPendientes,
  reprogramar,
} from "./outbox.ts";
import { decidirTrasError } from "./reintentos.ts";

/**
 * Entrega de la bandeja de salida por Telegram.
 *
 * Garantía: AL MENOS UNA VEZ, con la ventana de duplicado más corta posible. Telegram no tiene clave de
 * idempotencia en `sendMessage`, así que un envío que Telegram aceptó pero cuya confirmación se perdió (el
 * proceso murió entre la respuesta y el UPDATE, o el UPDATE no pudo escribirse) se reintenta. Todo lo demás es
 * exactamente una vez: una fila nunca se envía dos veces tras marcarse `enviada`, una fila nunca se reclama
 * por dos notifiers a la vez (SKIP LOCKED + arrendamiento) y un rechazo definitivo de Telegram no se reintenta.
 * Se prefiere un duplicado raro a perder una alerta de agua.
 */

export interface CanalTelegram {
  enviarMensaje(chatId: number, texto: string): Promise<void>;
}

export interface MetricasEnviador {
  enviados(): void;
  errores(codigo: string): void;
  reintentos(): void;
  fallidos(): void;
  descartados(): void;
  /** Segundos entre el momento en que el aviso podía salir y el primer envío exitoso. */
  latencia(segundos: number): void;
}

export interface OpcionesEnviador {
  bd: BdSistema;
  telegram: CanalTelegram;
  log: Logger;
  metricas?: Partial<MetricasEnviador>;
  /** Filas por reclamo. */
  lote?: number;
  /** Chats atendidos a la vez (dentro de un chat, en orden). */
  concurrencia?: number;
  arrendamientoS?: number;
}

export interface Enviador {
  /** Reclama y envía lo vencido hasta vaciarlo. Devuelve cuántas filas reclamó. */
  procesar(): Promise<number>;
}

const contenido = z.object({ texto: z.string().min(1) }).passthrough();

export function crearEnviador(op: OpcionesEnviador): Enviador {
  const { bd, telegram, log } = op;
  const lote = op.lote ?? 50;
  const concurrencia = op.concurrencia ?? 8;
  const arrendamientoS = op.arrendamientoS ?? ARRENDAMIENTO_S;
  const m = op.metricas ?? {};

  /** Confirmar con reintentos cortos: un UPDATE perdido después de un envío exitoso es el único camino a un duplicado. */
  async function confirmar(fila: FilaSalida): Promise<void> {
    let ultimo: unknown;
    for (let i = 0; i < 4; i++) {
      try {
        await marcarEnviada(bd, fila.id);
        return;
      } catch (error) {
        ultimo = error;
        await new Promise((r) => setTimeout(r, 200 * 2 ** i));
      }
    }
    log.error(
      { err: ultimo, avisoId: fila.id },
      "se envió el aviso pero no se pudo marcar como enviado: puede repetirse",
    );
  }

  async function enviarUna(fila: FilaSalida): Promise<void> {
    const c = contenido.safeParse(fila.payload);
    if (!c.success) {
      await cerrarSinEnviar(bd, fila.id, "fallida", "payload_invalido");
      m.fallidos?.();
      log.error({ avisoId: fila.id }, "aviso con contenido inválido");
      return;
    }
    if (fila.chat_id === null) {
      await cerrarSinEnviar(bd, fila.id, "descartada", "sin_vinculo");
      m.descartados?.();
      return;
    }

    try {
      await telegram.enviarMensaje(Number(fila.chat_id), c.data.texto);
    } catch (error) {
      await tras(fila, error);
      return;
    }
    await confirmar(fila);
    m.enviados?.();
    // Solo el primer intento mide la entrega; un reintento después de un fallo no es latencia del sistema.
    if (fila.intentos === 1)
      m.latencia?.((Date.now() - new Date(fila.programada).getTime()) / 1000);
  }

  async function tras(fila: FilaSalida, error: unknown): Promise<void> {
    const codigo = error instanceof ErrorTelegram ? error.codigo : undefined;
    const descripcion = error instanceof ErrorTelegram ? error.descripcion : "error desconocido";
    const espera = error instanceof ErrorTelegram ? error.reintentarEnS : undefined;
    m.errores?.(codigo === undefined ? "red" : String(codigo));

    const d = decidirTrasError(fila.intentos, codigo, descripcion, espera);
    switch (d.tipo) {
      case "reintentar":
        await reprogramar(
          bd,
          fila.id,
          d.esperaS,
          `${codigo ?? "red"}: ${descripcion}`.slice(0, 300),
        );
        m.reintentos?.();
        log.warn(
          { avisoId: fila.id, intentos: fila.intentos, codigo, esperaS: d.esperaS },
          "Telegram no aceptó el aviso: se reintenta",
        );
        return;
      case "descartar":
        await olvidarVinculo(bd, fila.usuario_id);
        await cerrarSinEnviar(bd, fila.id, "descartada", d.motivo);
        m.descartados?.();
        log.info(
          { avisoId: fila.id },
          "el usuario ya no recibe mensajes del bot: vínculo eliminado",
        );
        return;
      case "fallida":
        await cerrarSinEnviar(bd, fila.id, "fallida", d.motivo);
        m.fallidos?.();
        // Alerta interna: el aviso de un cliente no salió. (El canal de alertas internas llega con H6.)
        log.error(
          {
            avisoId: fila.id,
            alarmaId: fila.alarma_id,
            intentos: fila.intentos,
            codigo,
            motivo: d.motivo,
          },
          "aviso fallido: no se pudo entregar",
        );
        return;
    }
  }

  async function reclamar(): Promise<FilaSalida[]> {
    return conSistema(bd, (tx) => reclamarPendientes(tx, lote, arrendamientoS));
  }

  return {
    async procesar() {
      let total = 0;
      for (;;) {
        const filas = await reclamar();
        total += filas.length;
        if (filas.length === 0) return total;

        // Un chat a la vez conserva el orden de sus mensajes; chats distintos van en paralelo.
        const porChat = new Map<string, FilaSalida[]>();
        for (const f of filas) {
          const clave = f.chat_id ?? `sin:${f.id}`;
          const lista = porChat.get(clave);
          if (lista) lista.push(f);
          else porChat.set(clave, [f]);
        }
        const grupos = [...porChat.values()];
        let siguiente = 0;
        const trabajadores = Array.from(
          { length: Math.min(concurrencia, grupos.length) },
          async () => {
            while (siguiente < grupos.length) {
              const grupo = grupos[siguiente++] as FilaSalida[];
              for (const fila of grupo) {
                try {
                  await enviarUna(fila);
                } catch (error) {
                  // Falla de la base al registrar el resultado: la fila reaparece al vencer su arrendamiento.
                  log.error(
                    { err: error, avisoId: fila.id },
                    "no se pudo registrar el resultado del aviso",
                  );
                }
              }
            }
          },
        );
        await Promise.all(trabajadores);
        if (filas.length < lote) return total;
      }
    },
  };
}
