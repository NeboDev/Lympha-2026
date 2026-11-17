import type { ActualizacionTelegram, ClienteTelegram } from "./telegram-api.ts";

export type ManejadorActualizacion = (actualizacion: ActualizacionTelegram) => Promise<void>;

export type LoggerPolling = {
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
};

export type OpcionesPolling = {
  cliente: Pick<ClienteTelegram, "obtenerActualizaciones" | "borrarWebhook">;
  manejar: ManejadorActualizacion;
  logger: LoggerPolling;
  /** Segundos que Telegram retiene la petición esperando actualizaciones. */
  esperaS?: number;
  /** Espera inicial tras un error (se duplica hasta 30 s). */
  esperaErrorMs?: number;
};

export type Polling = { detener(): Promise<void> };

const dormir = (ms: number, senal: AbortSignal) =>
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

/**
 * Long polling (`getUpdates`). Una actualización que falla se registra y se salta: el `offset`
 * avanza igual para no quedar atascados en un mensaje. Si falla la lectura, se reintenta con
 * espera exponencial (tope 30 s). Sin webhook: Atl no se despliega fuera de la red local.
 */
export async function iniciarPolling(op: OpcionesPolling): Promise<Polling> {
  const control = new AbortController();
  const esperaS = op.esperaS ?? 30;
  const esperaInicial = op.esperaErrorMs ?? 1000;
  let espera = esperaInicial;
  let offset = 0;

  await op.cliente.borrarWebhook();

  const bucle = (async () => {
    while (!control.signal.aborted) {
      try {
        const lote = await op.cliente.obtenerActualizaciones(offset, esperaS, control.signal);
        espera = esperaInicial;
        for (const actualizacion of lote) {
          offset = Math.max(offset, actualizacion.update_id + 1);
          try {
            await op.manejar(actualizacion);
          } catch (e) {
            op.logger.error(
              {
                causa: e instanceof Error ? e.message : "error",
                update_id: actualizacion.update_id,
              },
              "Telegram: falló el manejo de una actualización",
            );
          }
        }
      } catch (e) {
        if (control.signal.aborted) break;
        op.logger.warn(
          { causa: e instanceof Error ? e.message : "error" },
          "Telegram: no se pudo leer; se reintenta",
        );
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
