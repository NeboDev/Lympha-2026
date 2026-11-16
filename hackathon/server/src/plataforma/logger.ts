import { pino } from "pino";

/** Logger sin secretos ni datos personales: se registran ids, nunca correos ni tokens. */
export function crearLogger(nivel = "info") {
  return pino({
    level: nivel,
    redact: {
      paths: [
        "token",
        "*.token",
        "token_cifrado",
        "*.token_cifrado",
        "authorization",
        "req.headers.authorization",
        "correo",
        "*.correo",
        "uri",
        "*.uri",
      ],
      censor: "[oculto]",
    },
  });
}

export type Logger = ReturnType<typeof crearLogger>;
