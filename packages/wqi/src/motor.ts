import { analizarVentana } from "./confianza.ts";
import { type Evaluacion, evaluar, redondear } from "./evaluar.ts";
import { type Frase, frasePara, type ParametroInvalido } from "./frases.ts";
import { avanzarCanal, type Canal, canalNuevo, nivelCandidato } from "./histeresis.ts";
import {
  CONFIANZAS,
  type Confianza,
  type ConfigPerfil,
  type Direccion,
  type Lectura,
  NIVELES,
  type Nivel,
  PARAMETROS,
  type Parametro,
} from "./tipos.ts";

/**
 * Motor de estado de un nodo: ventana móvil + mediana + histéresis, todo puro.
 * El worker guarda `EstadoMotor` (JSON) entre lecturas; las pruebas y el simulador lo corren en memoria.
 */

export interface LimitanteReciente {
  parametro: Parametro;
  direccion: Direccion;
}

export interface EstadoMotor {
  /** Últimas lecturas del nodo en orden cronológico (a lo más `ventana.tamano`). */
  ventana: Lectura[];
  /** Hora de la última lectura procesada; las anteriores o repetidas se ignoran (idempotencia). */
  ultimoTs: number | null;
  nivel: Canal<Nivel>;
  confianza: Canal<Confianza>;
  /** Último parámetro responsable visto; sostiene la frase mientras el nivel confirmado sigue vigente. */
  limitante: LimitanteReciente | null;
}

export function estadoMotorNuevo(): EstadoMotor {
  return {
    ventana: [],
    ultimoTs: null,
    nivel: canalNuevo(),
    confianza: canalNuevo(),
    limitante: null,
  };
}

export interface Resultado {
  ts: number;
  version: string;
  /** Nivel que se muestra: ya con histéresis y con la confianza del sensor aplicada. */
  nivel: Nivel;
  wqi: number | null;
  confianza: Confianza;
  parametroLimitante: Parametro | null;
  subindices: Evaluacion["subindices"];
  invalidos: ParametroInvalido[];
  frase: Frase;
}

export interface Procesado {
  estado: EstadoMotor;
  /** `null` si la lectura se ignoró por ser anterior o repetida. */
  resultado: Resultado | null;
}

/**
 * Procesa una lectura nueva. Reglas que combinan nivel y confianza:
 *   - Con el sensor en `revisar`, un nivel bueno o regular no se puede afirmar → se muestra `sin_datos`.
 *     Un nivel malo o crítico se conserva: lo miden sensores que sí funcionan.
 *   - Antes de `minimoLecturas` lecturas, `sin_datos`.
 */
export function procesarLectura(
  perfil: ConfigPerfil,
  previo: EstadoMotor,
  lectura: Lectura,
): Procesado {
  if (previo.ultimoTs !== null && lectura.ts <= previo.ultimoTs) {
    return { estado: previo, resultado: null };
  }

  const ventana = [...previo.ventana, lectura].slice(-perfil.ventana.tamano);
  const analisis = analizarVentana(perfil, ventana);

  if (ventana.length < perfil.ventana.minimoLecturas) {
    const estado: EstadoMotor = { ...previo, ventana, ultimoTs: lectura.ts };
    return {
      estado,
      resultado: {
        ts: lectura.ts,
        version: perfil.version,
        nivel: "sin_datos",
        wqi: null,
        confianza: "ok",
        parametroLimitante: null,
        subindices: {},
        invalidos: analisis.invalidos,
        frase: frasePara({ nivel: "sin_datos", confianza: "ok", limitante: null, invalidos: [] }),
      },
    };
  }

  const evaluacion = evaluar(perfil, analisis.medianas);
  const candidato = nivelCandidato(perfil, evaluacion.puntajeDecision, previo.nivel.actual);

  const nivel = avanzarCanal(previo.nivel, candidato, NIVELES, perfil.histeresis.confirmarNivel);
  const confianza = avanzarCanal(
    previo.confianza,
    analisis.confianza,
    CONFIANZAS,
    perfil.histeresis.confirmarConfianza,
  );

  const nivelConfirmado = nivel.actual ?? "sin_datos";
  const confianzaConfirmada = confianza.actual ?? "ok";
  const limitante = evaluacion.limitante ?? previo.limitante;

  const conservaNivel = nivelConfirmado === "mala" || nivelConfirmado === "critica";
  const mostrado: Nivel =
    confianzaConfirmada === "revisar" && !conservaNivel ? "sin_datos" : nivelConfirmado;

  // Parámetro que se culpa: el del nivel si lo hay; si no, el sensor que hay que revisar.
  const sensor = analisis.invalidos.find((i) => i.motivo !== "ausente") ?? analisis.invalidos[0];
  let parametroLimitante: Parametro | null = null;
  if (mostrado === "sin_datos") {
    // Si ningún sensor manda dato, la falla es del nodo y no de un parámetro en particular.
    const todosAusentes =
      analisis.invalidos.length === PARAMETROS.length &&
      analisis.invalidos.every((i) => i.motivo === "ausente");
    parametroLimitante = todosAusentes ? null : (sensor?.parametro ?? null);
  } else if (mostrado !== "buena") parametroLimitante = limitante?.parametro ?? null;

  const invalidos = confianzaConfirmada === "ok" ? [] : analisis.invalidos;
  const frase = frasePara({
    nivel: mostrado,
    confianza: confianzaConfirmada,
    limitante: mostrado === "buena" || mostrado === "sin_datos" ? null : limitante,
    invalidos,
  });

  const wqi =
    mostrado === "sin_datos" || evaluacion.wqi === null ? null : redondear(evaluacion.wqi);

  return {
    estado: { ventana, ultimoTs: lectura.ts, nivel, confianza, limitante },
    resultado: {
      ts: lectura.ts,
      version: perfil.version,
      nivel: mostrado,
      wqi,
      confianza: confianzaConfirmada,
      parametroLimitante,
      subindices: evaluacion.subindices,
      invalidos,
      frase,
    },
  };
}

/** Corre una serie completa de lecturas (pruebas, simulador y recuperación). */
export function evaluarSerie(
  perfil: ConfigPerfil,
  lecturas: readonly Lectura[],
  inicial: EstadoMotor = estadoMotorNuevo(),
): { estado: EstadoMotor; resultados: Resultado[] } {
  let estado = inicial;
  const resultados: Resultado[] = [];
  for (const lectura of lecturas) {
    const p = procesarLectura(perfil, estado, lectura);
    estado = p.estado;
    if (p.resultado) resultados.push(p.resultado);
  }
  return { estado, resultados };
}

/** Niveles que se mostraron, sin repetidos consecutivos: la secuencia de cambios que vería el usuario. */
export function transiciones(resultados: readonly Resultado[]): Nivel[] {
  const salida: Nivel[] = [];
  for (const r of resultados) if (salida[salida.length - 1] !== r.nivel) salida.push(r.nivel);
  return salida;
}
