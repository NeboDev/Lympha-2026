import { type Logger, pino } from "pino";

export type { Logger };

/** Campos que nunca deben llegar a los logs: sin datos personales ni secretos. */
const REDACTAR = [
  "password",
  "*.password",
  "authorization",
  "*.authorization",
  "req.headers.authorization",
  "req.headers.cookie",
  "email",
  "*.email",
  "token",
  "*.token",
];

export function crearLogger(proceso: string, nivel = "info"): Logger {
  return pino({
    level: nivel,
    base: { proceso },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACTAR, censor: "[redactado]" },
  });
}
