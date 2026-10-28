import type { EstadoCalibracion, ResumenCalibracion } from "@lympha/contracts";
import type { ComponentType } from "react";
import { IcoAlerta, IcoCheck, IcoMenos, type PropsIcono } from "../componentes/Iconos.tsx";
import { haceCuanto } from "../espacios/tiempo.ts";
import { ETIQUETA_ESTADO_CAL, fechaMexico } from "./utilidades.ts";

const ICONO: Record<EstadoCalibracion, ComponentType<PropsIcono>> = {
  sin_calibrar: IcoMenos,
  vigente: IcoCheck,
  vencida: IcoAlerta,
};

// El color de calidad del agua no se reutiliza para la calibración: solo la vencida llama la atención.
const CLASE: Record<EstadoCalibracion, string> = {
  sin_calibrar: "nivel-sin_datos",
  vigente: "nivel-sin_datos",
  vencida: "nivel-regular",
};

/** Estado de calibración de un nodo: texto, símbolo y, si la hay, cuándo se hizo la última (hora de México). */
export function InsigniaCalibracion({
  resumen,
  ahora,
}: {
  resumen: ResumenCalibracion;
  ahora: number;
}) {
  const Icono = ICONO[resumen.estado];
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`insignia ${CLASE[resumen.estado]}`}>
        <Icono tamano={15} grosor={2.6} />
        <span>{ETIQUETA_ESTADO_CAL[resumen.estado]}</span>
      </span>
      {resumen.ultima_en && (
        <span className="detalle text-xs">
          <span className="sr-only">Última calibración </span>
          <time dateTime={resumen.ultima_en} title={fechaMexico(resumen.ultima_en)}>
            {haceCuanto(resumen.ultima_en, ahora)}
          </time>
        </span>
      )}
    </span>
  );
}
