import { useRegisterSW } from "virtual:pwa-register/react";
import { useSyncExternalStore } from "react";

const suscribirEnLinea = (avisar: () => void) => {
  window.addEventListener("online", avisar);
  window.addEventListener("offline", avisar);
  return () => {
    window.removeEventListener("online", avisar);
    window.removeEventListener("offline", avisar);
  };
};

/** ¿El dispositivo tiene red? (No garantiza que la API responda, pero explica de entrada por qué no hay datos.) */
export const useEnLinea = (): boolean =>
  useSyncExternalStore(
    suscribirEnLinea,
    () => navigator.onLine,
    () => true,
  );

/**
 * Avisos de la PWA: hay una versión nueva (la persona decide cuándo actualizar) y el dispositivo está sin internet.
 * Sin red, la app abre (el cascarón está en el dispositivo) pero no muestra datos de nadie: la API nunca se guarda.
 */
export function AvisosPWA() {
  const {
    needRefresh: [hayNueva],
    updateServiceWorker,
  } = useRegisterSW();
  const enLinea = useEnLinea();

  if (enLinea && !hayNueva) return null;
  return (
    <div className="avisos-pwa">
      {!enLinea && (
        <p role="status">
          Sin conexión a internet. Lo que ves puede no estar al día, y no se muestran datos hasta
          que vuelva.
        </p>
      )}
      {hayNueva && (
        <p role="status">
          Hay una versión nueva de Lympha.{" "}
          <button type="button" className="enlace" onClick={() => void updateServiceWorker(true)}>
            Actualizar
          </button>
        </p>
      )}
    </div>
  );
}
