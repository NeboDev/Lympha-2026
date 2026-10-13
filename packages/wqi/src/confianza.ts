import type { MotivoInvalido, ParametroInvalido } from "./frases.ts";
import {
  type Confianza,
  type ConfigPerfil,
  type Lectura,
  type Mediciones,
  PARAMETROS,
  type Parametro,
} from "./tipos.ts";

/**
 * Confianza básica del sensor (RF-39). Por parámetro, sobre las últimas lecturas:
 *   - fuera de rango físico: la mayoría de las últimas `medianaDe` lecturas con dato cae fuera del
 *     rango que el sensor puede medir (un pH de 17 no existe) → `revisar`. Un valor suelto no cuenta.
 *   - congelado: las últimas `lecturasCongelado` lecturas son exactamente iguales → `revisar`.
 *   - ausente: ninguna de las últimas `medianaDe` lecturas trae dato → `dudosa`.
 * Un parámetro con problema no entra al cálculo del WQI.
 */

export interface AnalisisVentana {
  /** Confianza instantánea (antes de la histéresis del canal de confianza). */
  confianza: Confianza;
  invalidos: ParametroInvalido[];
  /** Mediana de cada parámetro válido; `null` para los ausentes o con problema. */
  medianas: Mediciones;
}

export function mediana(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const mitad = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1
    ? (ordenados[mitad] as number)
    : ((ordenados[mitad - 1] as number) + (ordenados[mitad] as number)) / 2;
}

function estaCongelado(valores: readonly (number | null)[], lecturasCongelado: number): boolean {
  if (valores.length < lecturasCongelado) return false;
  const ultimas = valores.slice(-lecturasCongelado);
  const primero = ultimas[0];
  return primero !== null && primero !== undefined && ultimas.every((v) => v === primero);
}

/** `ventana` va en orden cronológico (la más reciente al final). */
export function analizarVentana(
  perfil: ConfigPerfil,
  ventana: readonly Lectura[],
): AnalisisVentana {
  const recientes = ventana.slice(-perfil.ventana.medianaDe);
  const invalidos: ParametroInvalido[] = [];
  const medianas = Object.fromEntries(PARAMETROS.map((p) => [p, null])) as Mediciones;

  for (const parametro of PARAMETROS) {
    const [minimo, maximo] = perfil.parametros[parametro].rangoFisico;
    const conDato = recientes.map((l) => l[parametro]).filter((v): v is number => v !== null);

    let motivo: MotivoInvalido | null = null;
    if (conDato.length === 0) {
      motivo = "ausente";
    } else {
      const enRango = conDato.filter((v) => Number.isFinite(v) && v >= minimo && v <= maximo);
      const fuera = conDato.length - enRango.length;
      if (fuera * 2 > conDato.length) motivo = "fuera_de_rango";
      else if (
        estaCongelado(
          ventana.map((l) => l[parametro]),
          perfil.confianza.lecturasCongelado,
        )
      ) {
        motivo = "congelado";
      }
      if (motivo === null) medianas[parametro] = mediana(enRango);
    }
    if (motivo !== null) invalidos.push({ parametro, motivo });
  }

  // Los problemas que obligan a revisar el sensor van primero; la ausencia solo lo vuelve dudoso.
  invalidos.sort((a, b) => Number(a.motivo === "ausente") - Number(b.motivo === "ausente"));
  const confianza: Confianza = invalidos.some((i) => i.motivo !== "ausente")
    ? "revisar"
    : invalidos.length > 0
      ? "dudosa"
      : "ok";
  return { confianza, invalidos, medianas };
}
