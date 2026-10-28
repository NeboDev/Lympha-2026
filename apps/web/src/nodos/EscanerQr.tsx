import { useEffect, useRef, useState } from "react";
import { IcoX } from "../componentes/Iconos.tsx";

/** `BarcodeDetector` aún no está en los tipos de DOM de TypeScript. */
interface DetectorDeCodigos {
  detect(fuente: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type ConstructorDetector = new (opciones: { formats: string[] }) => DetectorDeCodigos;

const detectorDelNavegador = (): ConstructorDetector | undefined =>
  (globalThis as { BarcodeDetector?: ConstructorDetector }).BarcodeDetector;

/** ¿Puede este navegador escanear QR? (Chrome y Edge sí; Safari y Firefox todavía no.) */
export const escaneoDisponible = (): boolean =>
  detectorDelNavegador() !== undefined && !!navigator.mediaDevices?.getUserMedia;

/** Lee un QR con la cámara trasera. El video nunca sale del dispositivo. */
export function EscanerQr({
  alLeer,
  alCerrar,
}: {
  alLeer: (texto: string) => void;
  alCerrar: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // se guardan en refs para que cambiar los callbacks no reinicie la cámara
  const leer = useRef(alLeer);
  leer.current = alLeer;

  useEffect(() => {
    const Detector = detectorDelNavegador();
    if (!Detector) return;
    let vivo = true;
    let flujo: MediaStream | null = null;
    let reloj: ReturnType<typeof setInterval> | undefined;

    (async () => {
      try {
        flujo = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
        });
        if (!vivo || !video.current) return;
        video.current.srcObject = flujo;
        await video.current.play();
        const detector = new Detector({ formats: ["qr_code"] });
        reloj = setInterval(async () => {
          if (!video.current) return;
          const [hallazgo] = await detector.detect(video.current).catch(() => []);
          if (hallazgo && vivo) {
            vivo = false;
            leer.current(hallazgo.rawValue);
          }
        }, 300);
      } catch {
        setError("No pudimos usar la cámara. Permite el acceso o escribe el código a mano.");
      }
    })();

    return () => {
      vivo = false;
      if (reloj) clearInterval(reloj);
      for (const pista of flujo?.getTracks() ?? []) pista.stop();
    };
  }, []);

  return (
    <div className="escaner">
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <video ref={video} muted playsInline aria-label="Vista de la cámara para leer el QR" />
      )}
      <button type="button" className="secundario" onClick={alCerrar}>
        <IcoX tamano={18} /> Cerrar la cámara
      </button>
    </div>
  );
}
