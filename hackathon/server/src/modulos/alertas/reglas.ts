import type { UltimoNodo } from "../nodos/index.ts";
import type { AlertaDoc, SeveridadAlerta, TipoAlerta } from "./puertos.ts";

/** Una alerta que, según la última foto del nodo, debería estar abierta. */
export type AlertaDeseada = {
  tipo: TipoAlerta;
  parametro: string | null;
  severidad: SeveridadAlerta;
  valor: number | null;
};

const RANGO: Record<SeveridadAlerta, number> = { atencion: 0, alta: 1, critica: 2 };

export const mayorSeveridad = (a: SeveridadAlerta, b: SeveridadAlerta): SeveridadAlerta =>
  RANGO[a] >= RANGO[b] ? a : b;

/**
 * Qué alertas deben existir dado el estado confirmado del nodo (ya con histéresis, ver
 * `modulos/evaluacion`). Un nodo detenido solo tiene la alerta de «sin conexión»: sus estados
 * están viejos y no se juzgan.
 *
 * - `fuera_de_rango` → `nivel` alta · `critico` → `nivel` crítica
 * - `revisar_sensor` → `sensor` alta
 * - `atencion` por cambio rápido → `cambio_rapido` (la atención por cercanía al límite no avisa)
 */
export function alertasDeseadas(ultimo: UltimoNodo): AlertaDeseada[] {
  if (ultimo.sin_datos) {
    return [{ tipo: "sin_conexion", parametro: null, severidad: "alta", valor: null }];
  }
  const deseadas: AlertaDeseada[] = [];
  for (const [parametro, estado] of Object.entries(ultimo.estados)) {
    const valor = ultimo.v[parametro] ?? null;
    switch (estado) {
      case "fuera_de_rango":
        deseadas.push({ tipo: "nivel", parametro, severidad: "alta", valor });
        break;
      case "critico":
        deseadas.push({ tipo: "nivel", parametro, severidad: "critica", valor });
        break;
      case "revisar_sensor":
        deseadas.push({ tipo: "sensor", parametro, severidad: "alta", valor });
        break;
      case "atencion":
        if (ultimo.detalles?.[parametro]?.cambio_rapido) {
          deseadas.push({ tipo: "cambio_rapido", parametro, severidad: "atencion", valor });
        }
        break;
      default:
        break;
    }
  }
  return deseadas;
}

export type AlertaAbierta = Pick<
  AlertaDoc,
  "_id" | "tipo" | "parametro" | "severidad" | "severidad_maxima" | "ultimo_aviso" | "abierta"
>;

export type Accion =
  | { tipo: "abrir"; deseada: AlertaDeseada }
  | { tipo: "escalar"; alerta: AlertaAbierta; a: SeveridadAlerta }
  | { tipo: "bajar"; alerta: AlertaAbierta; a: SeveridadAlerta }
  /** `silenciosa`: se cierra sin avisar porque no es una recuperación (el mismo parámetro sigue con otra alerta). */
  | { tipo: "cerrar"; alerta: AlertaAbierta; silenciosa: boolean };

const clave = (a: { tipo: TipoAlerta; parametro: string | null }) =>
  `${a.tipo}:${a.parametro ?? ""}`;

/** Qué tan grave es cada tipo cuando dos alertas del mismo parámetro se reemplazan entre sí. */
const GRAVEDAD_TIPO: Record<TipoAlerta, number> = {
  cambio_rapido: 0,
  sin_conexion: 0,
  nivel: 1,
  sensor: 2,
};

/**
 * Compara lo que hay abierto con lo que debería haber y devuelve lo que hay que hacer. Pura e
 * idempotente: aplicarla dos veces sobre el mismo estado no cambia nada la segunda vez.
 * `congelado` = el nodo está detenido: solo se gobierna «sin conexión»; las demás alertas se dejan
 * como están (cerrarlas diría «volvió al rango» sin saber nada).
 */
export function reconciliar(
  abiertas: AlertaAbierta[],
  deseadas: AlertaDeseada[],
  congelado: boolean,
): Accion[] {
  const acciones: Accion[] = [];
  const porClave = new Map(abiertas.map((a) => [clave(a), a]));

  for (const d of deseadas) {
    const abierta = porClave.get(clave(d));
    if (!abierta) {
      acciones.push({ tipo: "abrir", deseada: d });
    } else if (RANGO[d.severidad] > RANGO[abierta.severidad]) {
      acciones.push({ tipo: "escalar", alerta: abierta, a: d.severidad });
    } else if (RANGO[d.severidad] < RANGO[abierta.severidad]) {
      acciones.push({ tipo: "bajar", alerta: abierta, a: d.severidad });
    }
  }

  const deseadasClaves = new Set(deseadas.map(clave));
  for (const a of abiertas) {
    if (deseadasClaves.has(clave(a))) continue;
    if (congelado && a.tipo !== "sin_conexion") continue;
    // Es una recuperación (con aviso) salvo que otra alerta MÁS GRAVE del mismo parámetro la reemplace:
    // un cambio rápido que pasa a fuera de rango, o un nivel que pasa a «revisar sensor» (la lectura
    // ya no es confiable, no se puede decir que «volvió al rango»).
    const silenciosa =
      a.parametro !== null &&
      deseadas.some(
        (d) => d.parametro === a.parametro && GRAVEDAD_TIPO[d.tipo] > GRAVEDAD_TIPO[a.tipo],
      );
    acciones.push({ tipo: "cerrar", alerta: a, silenciosa });
  }
  return acciones;
}

/**
 * ¿Toca un recordatorio? Cada `recordatorioMin` (la mitad si es crítica). Los cambios rápidos no
 * recuerdan (son informativos) y sin un primer aviso no hay nada que recordar.
 */
export function recordatorioDebido(
  alerta: Pick<AlertaDoc, "tipo" | "severidad" | "ultimo_aviso">,
  ahora: Date,
  recordatorioMin: number,
): boolean {
  if (alerta.tipo === "cambio_rapido" || alerta.ultimo_aviso === null) return false;
  const minutos = alerta.severidad === "critica" ? recordatorioMin / 2 : recordatorioMin;
  return ahora.getTime() - alerta.ultimo_aviso.getTime() >= minutos * 60_000;
}
