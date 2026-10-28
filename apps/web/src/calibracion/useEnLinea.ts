import { useSyncExternalStore } from "react";

function suscribir(alCambiar: () => void) {
  window.addEventListener("online", alCambiar);
  window.addEventListener("offline", alCambiar);
  return () => {
    window.removeEventListener("online", alCambiar);
    window.removeEventListener("offline", alCambiar);
  };
}

/**
 * ¿El navegador cree tener red? El service worker deja cargar la pantalla sin conexión, pero calibrar necesita
 * la API (lecturas en vivo y guardado), así que la pantalla avisa y bloquea el asistente. Es una pista: un fallo de
 * red real igual se muestra como error de la petición.
 */
export function useEnLinea(): boolean {
  return useSyncExternalStore(
    suscribir,
    () => navigator.onLine,
    () => true,
  );
}
