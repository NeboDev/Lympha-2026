import type { Logger } from "./logger.ts";

/**
 * Apagado ordenado: ante SIGTERM/SIGINT (docker stop, despliegue) ejecuta `cerrar` una sola vez y
 * sale. Un segundo ciclo de señales o un cierre que tarda más de `limiteMs` fuerza la salida.
 */
export function alApagar(log: Logger, cerrar: () => Promise<void>, limiteMs = 25_000): void {
  let cerrando = false;
  const manejar = (senal: string) => {
    if (cerrando) return;
    cerrando = true;
    log.info({ senal }, "apagando");
    const forzar = setTimeout(() => {
      log.error("el cierre ordenado tardó demasiado; se fuerza la salida");
      process.exit(1);
    }, limiteMs);
    forzar.unref();
    cerrar().then(
      () => process.exit(0),
      (error: unknown) => {
        log.error({ err: error }, "error al cerrar");
        process.exit(1);
      },
    );
  };
  process.on("SIGTERM", () => manejar("SIGTERM"));
  process.on("SIGINT", () => manejar("SIGINT"));
}
