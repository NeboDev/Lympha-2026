/** Única pieza que habla con Blynk. Por ahora solo comprueba que el host responde. */
export async function blynkAlcanzable(host: string, tiempoMs = 3000): Promise<boolean> {
  try {
    // Un token inválido responde 400: basta con que el servidor conteste.
    const r = await fetch(`https://${host}/external/api/isHardwareConnected?token=salud`, {
      signal: AbortSignal.timeout(tiempoMs),
    });
    return r.status > 0 && r.status < 500;
  } catch {
    return false;
  }
}
