/**
 * Un enlace de Telegram solo se muestra como enlace si de verdad apunta a t.me por https con un `start`:
 * lo que llega de la API nunca se pone en un `href` sin comprobarlo.
 */
export const esEnlaceTelegram = (u: string): boolean =>
  /^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}\?start(?:group)?=[A-Za-z0-9_-]{16,64}$/.test(u);
