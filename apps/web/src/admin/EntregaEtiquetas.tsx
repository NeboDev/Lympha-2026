import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IcoAlerta, IcoQr } from "../componentes/Iconos.tsx";
import {
  archivosDelLote,
  descargar,
  ETIQUETAS_POR_HOJA,
  type LoteEntregado,
  type ModoImpresion,
  reglaPagina,
  svgComoUrl,
} from "./entrega.ts";
import { crearZip } from "./zip.ts";

/** Zona que solo existe al imprimir: cuelga de `<body>` para que `#raiz` se oculte entero con `@media print`. */
function ZonaImpresion({ lote, modo }: { lote: LoteEntregado; modo: ModoImpresion }) {
  return createPortal(
    <div className={`zona-impresion modo-${modo}`}>
      <style>{reglaPagina(modo)}</style>
      {lote.etiquetas.map((e) => (
        <img
          key={e.device_id}
          className="etiqueta-impresa"
          src={svgComoUrl(e.svg)}
          alt={`Etiqueta del nodo ${e.red_ap}`}
        />
      ))}
    </div>,
    document.body,
  );
}

/**
 * Entrega de las etiquetas recién creadas. Los códigos de reclamo, las claves del punto de acceso y las contraseñas
 * MQTT se muestran UNA sola vez: el servidor no los conserva, así que aquí se imprimen y se descargan. Los datos
 * viven solo en la memoria de esta pantalla y al cerrarla se pierden.
 */
export function EntregaEtiquetas({
  lote,
  titulo,
  alCerrar,
}: {
  lote: LoteEntregado;
  titulo: string;
  alCerrar: () => void;
}) {
  const [modo, setModo] = useState<ModoImpresion | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  // Mientras estos datos estén en pantalla, cerrar la pestaña los perdería: se avisa.
  useEffect(() => {
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, []);

  useEffect(() => {
    if (!modo) return;
    document.body.classList.add("imprimiendo");
    const terminar = () => setModo(null);
    window.addEventListener("afterprint", terminar);
    const t = setTimeout(() => window.print(), 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", terminar);
      document.body.classList.remove("imprimiendo");
    };
  }, [modo]);

  const hojas = Math.ceil(lote.etiquetas.length / ETIQUETAS_POR_HOJA);

  return (
    <section className="grid gap-4" aria-labelledby="titulo-entrega">
      <div
        role="alert"
        className="tarjeta nivel-mala flex items-start gap-3 border-l-[6px] border-l-(--fondo) p-4"
      >
        <IcoAlerta tamano={22} className="mt-0.5 shrink-0" />
        <div className="grid gap-1">
          <strong id="titulo-entrega">{titulo}</strong>
          <p className="m-0">
            Los códigos de reclamo, las claves del punto de acceso y las contraseñas de los nodos se
            muestran <strong>una sola vez</strong>. Lympha no los guarda: si cierras esta pantalla
            sin imprimirlos o descargarlos, no se pueden volver a ver.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setModo("hoja");
            setGuardado(true);
          }}
        >
          <IcoQr tamano={18} /> Imprimir hoja A4 ({hojas} {hojas === 1 ? "página" : "páginas"})
        </button>
        <button
          type="button"
          className="secundario"
          onClick={() => {
            setModo("rollo");
            setGuardado(true);
          }}
        >
          Imprimir etiquetas de 80 × 44 mm una por una
        </button>
        <button
          type="button"
          className="secundario"
          onClick={() => {
            descargar(
              `lympha-lote-${lote.loteId}.zip`,
              crearZip(archivosDelLote(lote)) as BlobPart,
              "application/zip",
            );
            setGuardado(true);
          }}
        >
          Descargar ZIP (etiquetas SVG e identidades)
        </button>
      </div>
      <p className="detalle m-0">
        Imprime al <strong>100 %</strong> (sin «ajustar a la página»): cada etiqueta mide
        exactamente 80 × 44 mm. El ZIP trae <code>identidades.json</code> y{" "}
        <code>manifiesto.json</code> con el formato de <code>pnpm factory</code>, para grabar los
        nodos; guárdalo con cuidado y bórralo cuando termines.
      </p>

      <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
        {lote.etiquetas.map((e) => (
          <li key={e.device_id} className="tarjeta grid justify-items-start gap-2 p-3">
            <img
              src={svgComoUrl(e.svg)}
              alt={`Etiqueta del nodo ${e.red_ap}`}
              className="max-w-full border border-line"
              style={{ width: "80mm", height: "44mm" }}
            />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-bold">{e.red_ap}</span>
              <span className="detalle">{e.device_id}</span>
            </div>
            <button
              type="button"
              className="secundario"
              onClick={() => {
                descargar(`etiqueta-${e.red_ap}.svg`, e.svg, "image/svg+xml");
                setGuardado(true);
              }}
            >
              Descargar SVG
            </button>
          </li>
        ))}
      </ul>

      {confirmando ? (
        <div role="alert" className="tarjeta grid gap-3 p-4">
          <p className="m-0">
            {guardado
              ? "¿Ya tienes las etiquetas impresas o descargadas? No se podrán ver otra vez."
              : "Todavía no imprimiste ni descargaste nada. Si cierras ahora, estos códigos se pierden y tendrás que regenerar cada etiqueta."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="peligro" onClick={alCerrar}>
              Sí, cerrar y olvidar los códigos
            </button>
            <button type="button" className="secundario" onClick={() => setConfirmando(false)}>
              Volver
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="secundario justify-self-start"
          onClick={() => setConfirmando(true)}
        >
          Cerrar
        </button>
      )}

      {modo && <ZonaImpresion lote={lote} modo={modo} />}
    </section>
  );
}
