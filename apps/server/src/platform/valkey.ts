import { Redis } from "ioredis";

export type { Redis };

/**
 * Conexión de uso general. Cada proceso entra con su propio usuario ACL (en la URL), así que un
 * proceso comprometido no puede leer las claves de otro. `enableReadyCheck: false` evita el INFO
 * inicial de ioredis (BullMQ hace el suyo con +info).
 */
export function crearValkey(url: string, nombre: string): Redis {
  const cliente = new Redis(url, {
    connectionName: `lympha-${nombre}`,
    enableReadyCheck: false,
    maxRetriesPerRequest: 3,
    retryStrategy: (intento) => Math.min(intento * 200, 2000),
  });
  cliente.on("error", () => undefined); // los errores se observan por /health y los logs de quien consulta
  return cliente;
}

/** Conexión para BullMQ: exige `maxRetriesPerRequest: null` (comandos bloqueantes). */
export function crearConexionBullmq(url: string, nombre: string): Redis {
  const cliente = new Redis(url, {
    connectionName: `lympha-bull-${nombre}`,
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
    retryStrategy: (intento) => Math.min(intento * 200, 2000),
  });
  cliente.on("error", () => undefined);
  return cliente;
}

export async function pingValkey(cliente: Redis): Promise<boolean> {
  try {
    return (await cliente.ping()) === "PONG";
  } catch {
    return false;
  }
}
