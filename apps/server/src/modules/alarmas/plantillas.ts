import type { EventoAviso, SeveridadAlarma, TipoAlarma } from "@lympha/contracts";

/**
 * Texto de los avisos de Telegram. Texto plano (sin `parse_mode`, así no hay nada que escapar) y sin
 * afirmar jamás que el agua sea potable ni segura (RNF-32). La causa y la acción vienen del motor WQI.
 */

export interface DatosAviso {
  evento: EventoAviso;
  tipo: TipoAlarma;
  /** Nombre que ve el usuario: el del nodo o uno genérico (ver `nombreNodo`). */
  nodo: string;
  espacio: string;
  severidad?: SeveridadAlarma | undefined;
  anterior?: SeveridadAlarma | undefined;
  causa?: string | null | undefined;
  accion?: string | null | undefined;
  /** Minutos transcurridos: sin conexión, o desde que se abrió la alarma (recordatorios). */
  minutos?: number | undefined;
}

const ROTULO: Record<SeveridadAlarma, string> = {
  regular: "regular",
  mala: "mala",
  critica: "crítica",
};
const ICONO: Record<SeveridadAlarma, string> = { regular: "🟡", mala: "🟠", critica: "🔴" };

export const nombreNodo = (nombre: string | null, id: string): string =>
  nombre?.trim() || `Nodo ${id.slice(-4)}`;

export function duracion(minutos: number): string {
  const m = Math.max(1, Math.round(minutos));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const resto = m % 60;
  if (h >= 48) return `${Math.floor(h / 24)} días`;
  return resto === 0 ? `${h} h` : `${h} h ${resto} min`;
}

const encabezado = (d: DatosAviso, icono: string, resto: string): string =>
  `${icono} ${d.nodo} · ${d.espacio}\n${resto}`;

function detalle(d: DatosAviso): string {
  const lineas: string[] = [];
  if (d.causa) lineas.push(`Causa: ${d.causa}`);
  if (d.accion) lineas.push(`Qué hacer: ${d.accion}`);
  return lineas.length > 0 ? `\n${lineas.join("\n")}` : "";
}

export function textoAviso(d: DatosAviso): string {
  const sev = d.severidad;
  switch (d.evento) {
    case "abierta":
      if (d.tipo === "sensor") return encabezado(d, "🛠", `Revisa el sensor.${detalle(d)}`);
      return encabezado(
        d,
        sev ? ICONO[sev] : "🟠",
        `Calidad del agua ${rotulo(sev)}.${detalle(d)}`,
      );
    case "escalada":
      return encabezado(
        d,
        sev ? ICONO[sev] : "🟠",
        `Empeoró: calidad ${rotulo(sev)} (antes ${rotulo(d.anterior)}).${detalle(d)}`,
      );
    case "mejorada":
      return encabezado(
        d,
        sev ? ICONO[sev] : "🟡",
        `Mejoró: calidad ${rotulo(sev)} (antes ${rotulo(d.anterior)}).${detalle(d)}`,
      );
    case "resuelta":
      if (d.tipo === "sensor")
        return encabezado(d, "🟢", "El sensor volvió a dar lecturas normales.");
      return encabezado(d, "🟢", "La calidad del agua volvió a buena.");
    case "recordatorio": {
      const desde = d.minutos === undefined ? "" : ` desde hace ${duracion(d.minutos)}`;
      if (d.tipo === "sin_conexion")
        return encabezado(d, "⏰", `Sigue sin conexión${desde}.${detalle(d)}`);
      if (d.tipo === "sensor")
        return encabezado(d, "⏰", `Sigue pendiente revisar el sensor${desde}.${detalle(d)}`);
      return encabezado(
        d,
        "⏰",
        `Recordatorio: la calidad sigue ${rotulo(sev)}${desde}.${detalle(d)}`,
      );
    }
    case "sin_conexion": {
      const hace = d.minutos === undefined ? "" : ` desde hace ${duracion(d.minutos)}`;
      return encabezado(
        d,
        "⚪",
        `Sin conexión${hace}.\nQué hacer: revisa que el nodo tenga corriente y que el Wi-Fi funcione.`,
      );
    }
    case "reconectado":
      return encabezado(d, "🟢", "El nodo volvió a conectarse.");
  }
}

function rotulo(sev: SeveridadAlarma | undefined): string {
  return sev ? ROTULO[sev] : "—";
}
