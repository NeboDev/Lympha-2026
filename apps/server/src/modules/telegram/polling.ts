import type { Logger } from "../../platform/logger.ts";
import type { ActualizacionTelegram, ClienteTelegram } from "./cliente.ts";

export type ManejadorActualizacion = (actualizacion: ActualizacionTelegram) => Promise<void>;

export interface OpcionesPolling {
  cliente: ClienteTelegram;
  manejar: ManejadorActualizacion;
  log: Logger;
  /** Segundos que Telegram retiene la petición esperando actualizaciones. */
  esperaS?: number;
  /** Espera inicial tras un error (se duplica hasta 30 s). */
  esperaErrorMs?: number;
}

export interface Polling {
  detener(): Promise<void>;
}

const dormir = (ms: number, senal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    senal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });

/**
 * Long polling (`getUpdates`) para desarrollo local, donde Telegram no puede alcanzar un webhook. Antes de
 * empezar se borra cualquier webhook (Telegram rechaza `getUpdates` con webhook activo). Una actualización que
 * falla se registra y se salta: el `offset` avanza igual para no quedar atascados en un mensaje.
 */
export async function iniciarPolling(op: OpcionesPolling): Promise<Polling> {
  const control = new AbortController();
  const esperaS = op.esperaS ?? 30;
  let espera = op.esperaErrorMs ?? 1000;
  let offset = 0;

  await op.cliente.borrarWebhook();

  const bucle = (async () => {
    while (!control.signal.aborted) {
      try {
        const lote = await op.cliente.obtenerActualizaciones(offset, esperaS, control.signal);
        espera = op.esperaErrorMs ?? 1000;
        for (const actualizacion of lote) {
          offset = Math.max(offset, actualizacion.update_id + 1);
          try {
            await op.manejar(actualizacion);
          } catch (error) {
            op.log.error(
              { err: error, updateId: actualizacion.update_id },
              "Telegram: falló el manejo",
            );
          }
        }
      } catch (error) {
        if (control.signal.aborted) break;
        op.log.warn({ err: error }, "Telegram: no se pudo leer; se reintenta");
        await dormir(espera, control.signal);
        espera = Math.min(espera * 2, 30_000);
      }
    }
  })();

  return {
    async detener() {
      control.abort();
      await bucle;
    },
  };
}
