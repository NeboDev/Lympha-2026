export type LoggerBucle = { warn(obj: object, msg?: string): void };

const dormirHasta = (ms: number, senal: AbortSignal) =>
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
 * Ejecuta `tarea` cada `cadaMs`, de forma secuencial (nunca dos a la vez). Un error se registra y
 * el bucle sigue. `detener()` interrumpe la espera y aguarda a que termine la tarea en curso.
 */
export function crearBucle(
  nombre: string,
  tarea: () => Promise<unknown>,
  cadaMs: number,
  logger: LoggerBucle,
) {
  const control = new AbortController();
  let bucle: Promise<void> | null = null;
  return {
    iniciar() {
      if (bucle) return;
      bucle = (async () => {
        while (!control.signal.aborted) {
          try {
            await tarea();
          } catch (e) {
            logger.warn(
              { bucle: nombre, causa: e instanceof Error ? e.message : "error" },
              "falló una pasada",
            );
          }
          await dormirHasta(cadaMs, control.signal);
        }
      })();
    },
    async detener() {
      control.abort();
      await bucle;
    },
  };
}
