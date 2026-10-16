import { useRegisterSW } from "virtual:pwa-register/react";
import { useSyncExternalStore } from "react";
import { IcoActualizar, IcoSinRed } from "../componentes/Iconos.tsx";

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
    <div className="avisos-pwa sticky top-0 z-30 grid gap-px border-b border-line bg-line lg:pl-64">
      {!enLinea && (
        <p
          role="status"
          className="nivel-sin_conexion m-0 flex items-start gap-2 bg-(--tinte) px-4 py-2.5 text-sm font-semibold text-text"
        >
          <IcoSinRed tamano={18} className="mt-0.5 shrink-0" />
          <span>
            Sin conexión a internet. Lo que ves puede no estar al día, y no se muestran datos hasta
            que vuelva.
          </span>
        </p>
      )}
      {hayNueva && (
        <p
          role="status"
          className="m-0 flex flex-wrap items-center gap-x-3 bg-brand-soft px-4 py-1 text-sm font-semibold text-text"
        >
          <IcoActualizar tamano={18} className="shrink-0 text-brand-text" />
          <span>Hay una versión nueva de Lympha.</span>
          <button type="button" className="enlace" onClick={() => void updateServiceWorker(true)}>
            Actualizar
          </button>
        </p>
      )}
    </div>
  );
}
