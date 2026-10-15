import type { PreferenciaNotificacion, SeveridadAlarma } from "@lympha/contracts";

export const NIVELES_ELEGIBLES: { valor: SeveridadAlarma; etiqueta: string }[] = [
  { valor: "regular", etiqueta: "Regular" },
  { valor: "mala", etiqueta: "Mala" },
  { valor: "critica", etiqueta: "Crítica" },
];

/** Lo que edita el formulario: texto y casillas, no el contrato. */
export interface BorradorPreferencia {
  niveles: SeveridadAlarma[];
  silencioActivo: boolean;
  silencioInicio: string;
  silencioFin: string;
  zonaHoraria: string;
  recordatorioH: string;
}

export const zonaDelNavegador = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Mexico_City";
  } catch {
    return "America/Mexico_City";
  }
};

export function aBorrador(p: PreferenciaNotificacion): BorradorPreferencia {
  return {
    niveles: p.niveles,
    silencioActivo: p.silencio_inicio !== null && p.silencio_fin !== null,
    silencioInicio: p.silencio_inicio ?? "22:00",
    silencioFin: p.silencio_fin ?? "07:00",
    zonaHoraria: p.zona_horaria,
    recordatorioH: String(p.recordatorio_h),
  };
}

export type ResultadoBorrador =
  | { ok: true; preferencia: PreferenciaNotificacion }
  | { ok: false; error: string };

/** Valida el borrador y arma lo que pide la API. Los mensajes son para la persona. */
export function dePreferencia(b: BorradorPreferencia, nodoId: string | null): ResultadoBorrador {
  const horas = Number(b.recordatorioH);
  if (!Number.isInteger(horas) || horas < 1 || horas > 72) {
    return { ok: false, error: "El recordatorio debe ser un número entero de horas, de 1 a 72." };
  }
  if (b.silencioActivo) {
    const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!hhmm.test(b.silencioInicio) || !hhmm.test(b.silencioFin)) {
      return { ok: false, error: "Elige la hora de inicio y de fin del horario silencioso." };
    }
    if (b.silencioInicio === b.silencioFin) {
      return {
        ok: false,
        error: "El inicio y el fin del horario silencioso no pueden ser iguales.",
      };
    }
  }
  if (b.zonaHoraria.trim() === "") return { ok: false, error: "Elige tu zona horaria." };
  return {
    ok: true,
    preferencia: {
      nodo_id: nodoId,
      niveles: NIVELES_ELEGIBLES.map((n) => n.valor).filter((v) => b.niveles.includes(v)),
      silencio_inicio: b.silencioActivo ? b.silencioInicio : null,
      silencio_fin: b.silencioActivo ? b.silencioFin : null,
      zona_horaria: b.zonaHoraria.trim(),
      recordatorio_h: horas,
    },
  };
}

/** «Mala y crítica · silencio 22:00–07:00 · recordatorio cada 6 h». */
export function resumenPreferencia(p: PreferenciaNotificacion): string {
  const nombres = p.niveles.map(
    (n) => NIVELES_ELEGIBLES.find((x) => x.valor === n)?.etiqueta.toLowerCase() ?? n,
  );
  // «mala», «mala y crítica», «regular, mala y crítica»
  const lista =
    nombres.length > 1
      ? `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`
      : (nombres[0] ?? "");
  const niveles =
    nombres.length === 0 ? "Sin avisos de calidad" : lista.replace(/^./, (c) => c.toUpperCase());
  const silencio =
    p.silencio_inicio && p.silencio_fin
      ? `silencio ${p.silencio_inicio}–${p.silencio_fin}`
      : "sin horario silencioso";
  return `${niveles} · ${silencio} · recordatorio cada ${p.recordatorio_h} h`;
}
