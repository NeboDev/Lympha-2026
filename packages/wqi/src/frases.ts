import type { Confianza, Direccion, Nivel, Parametro } from "./tipos.ts";

/**
 * Frases de causa probable y acción recomendada (RF-20), en español llano de México.
 *
 * Reglas de redacción (RNF-32): nunca afirmar que el agua es "potable" ni "segura"; Lympha mide
 * parámetros, no certifica. Ante un problema grave se recomienda no usarla para beber o cocinar
 * "hasta revisarla", no se declara una conclusión sanitaria. La prueba de frases lo verifica.
 */

export interface Frase {
  causa: string;
  accion: string;
}

export type MotivoInvalido = "fuera_de_rango" | "congelado" | "ausente";

export interface ParametroInvalido {
  parametro: Parametro;
  motivo: MotivoInvalido;
}

export interface ContextoFrase {
  nivel: Nivel;
  confianza: Confianza;
  limitante: { parametro: Parametro; direccion: Direccion } | null;
  invalidos: readonly ParametroInvalido[];
}

const NOMBRE_SENSOR: Record<Parametro, string> = {
  ph: "pH",
  temperatura: "temperatura",
  conductividad: "conductividad",
  turbidez: "turbidez",
  tds: "sólidos disueltos (TDS)",
};

interface Texto {
  causa: string;
  /** Acción cuando el nivel es regular. */
  leve: string;
  /** Acción cuando el nivel es mala o crítica. */
  grave: string;
}

const EVITAR_USO = "Evita usarla para beber o cocinar hasta revisarla";

const TEXTOS: Partial<Record<Parametro, Partial<Record<Direccion, Texto>>>> = {
  ph: {
    bajo: {
      causa: "El agua está más ácida de lo habitual (pH bajo).",
      leve: "Revisa si cambió la fuente de agua o si hubo lluvia fuerte, y vuelve a mirar en unas horas.",
      grave: `${EVITAR_USO}: pregunta a quien le da mantenimiento a la cisterna y pide un análisis si sigue igual.`,
    },
    alto: {
      causa: "El agua está más alcalina de lo habitual (pH alto).",
      leve: "Revisa si se usaron cal, cemento o productos de limpieza en la cisterna, y vuelve a mirar en unas horas.",
      grave: `${EVITAR_USO}: busca restos de cal, cemento o limpiadores en la cisterna y pide un análisis si sigue igual.`,
    },
  },
  turbidez: {
    alto: {
      causa: "El agua está turbia: puede haber sedimento, lodo o suciedad removida en la cisterna.",
      leve: "Revisa el filtro y programa la limpieza de la cisterna.",
      grave: `${EVITAR_USO}: limpia la cisterna, cambia el filtro o llama a quien le da mantenimiento.`,
    },
  },
  tds: {
    alto: {
      causa:
        "El agua trae más minerales o sales disueltas de lo habitual (sólidos disueltos altos).",
      leve: "Compara con tu lectura de siempre; si subió de golpe, revisa de dónde llegó el agua nueva.",
      grave: `${EVITAR_USO}: confirma el origen del agua y considera un análisis de laboratorio.`,
    },
  },
  conductividad: {
    alto: {
      causa: "El agua trae más sales disueltas de lo habitual (conductividad alta).",
      leve: "Compara con tu lectura de siempre; si subió de golpe, revisa de dónde llegó el agua nueva.",
      grave: `${EVITAR_USO}: confirma el origen del agua y considera un análisis de laboratorio.`,
    },
  },
  temperatura: {
    alto: {
      causa: "El agua está más caliente de lo habitual.",
      leve: "Revisa si el depósito recibe sol directo o está junto a una fuente de calor.",
      grave: "Protege el depósito del calor y revisa de nuevo cuando se enfríe.",
    },
    bajo: {
      causa: "El agua está más fría de lo habitual.",
      leve: "Revisa si el depósito está expuesto al frío o a corrientes de aire.",
      grave: "Protege el depósito del frío y revisa de nuevo cuando suba la temperatura.",
    },
  },
};

const GENERICA: Texto = {
  causa: "Uno de los valores medidos se salió de lo esperado.",
  leve: "Vigila el nodo en las próximas horas.",
  grave: `${EVITAR_USO} y consulta los valores en el modo avanzado.`,
};

const MOTIVO_SENSOR: Record<MotivoInvalido, (p: Parametro) => string> = {
  fuera_de_rango: (p) => `El sensor de ${NOMBRE_SENSOR[p]} da valores que no parecen reales.`,
  congelado: (p) =>
    `El sensor de ${NOMBRE_SENSOR[p]} lleva un buen rato marcando exactamente lo mismo.`,
  ausente: (p) => `El sensor de ${NOMBRE_SENSOR[p]} no está enviando mediciones.`,
};

const ACCION_SENSOR =
  "Revisa que el sensor esté sumergido, limpio y bien conectado; si sigue igual, contacta a soporte.";

const SIN_LECTURAS: Frase = {
  causa: "Todavía no hay suficientes lecturas del nodo.",
  accion: "Espera unos minutos; si no cambia, revisa que el nodo tenga energía y conexión.",
};

const NODO_SIN_MEDICIONES: Frase = {
  causa: "El nodo no está enviando mediciones de ningún sensor.",
  accion:
    "Revisa que el nodo tenga energía y que los sensores estén conectados; si sigue igual, contacta a soporte.",
};

const BUENA: Frase = {
  causa: "Los valores medidos están dentro de lo esperado para tu cisterna.",
  accion: "No necesitas hacer nada.",
};

function textoDe(limitante: ContextoFrase["limitante"]): Texto {
  if (!limitante) return GENERICA;
  return TEXTOS[limitante.parametro]?.[limitante.direccion] ?? GENERICA;
}

/** Textos que puede producir el motor, para que las pruebas revisen su redacción. */
export function todasLasFrases(): string[] {
  const salida: string[] = [BUENA.causa, BUENA.accion, SIN_LECTURAS.causa, SIN_LECTURAS.accion];
  salida.push(NODO_SIN_MEDICIONES.causa, NODO_SIN_MEDICIONES.accion);
  salida.push(GENERICA.causa, GENERICA.leve, GENERICA.grave, ACCION_SENSOR);
  for (const p of Object.keys(NOMBRE_SENSOR) as Parametro[]) {
    for (const motivo of Object.values(MOTIVO_SENSOR)) salida.push(motivo(p));
  }
  for (const porDireccion of Object.values(TEXTOS)) {
    for (const t of Object.values(porDireccion ?? {})) salida.push(t.causa, t.leve, t.grave);
  }
  return salida;
}

/** Causa probable y acción recomendada para el estado que se muestra. */
export function frasePara(c: ContextoFrase): Frase {
  const sensor = c.invalidos.find((i) => i.motivo !== "ausente");
  const sensorSospechoso = c.confianza === "revisar" && sensor !== undefined;

  if (c.nivel === "sin_datos") {
    if (sensorSospechoso) {
      return { causa: MOTIVO_SENSOR[sensor.motivo](sensor.parametro), accion: ACCION_SENSOR };
    }
    const ausentes = c.invalidos.filter((i) => i.motivo === "ausente");
    if (ausentes.length === Object.keys(NOMBRE_SENSOR).length) return NODO_SIN_MEDICIONES;
    const ausente = ausentes[0];
    if (ausente) {
      return { causa: MOTIVO_SENSOR.ausente(ausente.parametro), accion: ACCION_SENSOR };
    }
    return SIN_LECTURAS;
  }

  let frase: Frase;
  if (c.nivel === "buena") {
    frase = BUENA;
  } else {
    const t = textoDe(c.limitante);
    frase = { causa: t.causa, accion: c.nivel === "regular" ? t.leve : t.grave };
  }
  // Con un nivel ya mostrado y un sensor dudoso, la nota del sensor se suma a la acción.
  if (sensorSospechoso) {
    frase = {
      causa: frase.causa,
      accion: `${frase.accion} Además, ${lowerFirst(MOTIVO_SENSOR[sensor.motivo](sensor.parametro))} ${ACCION_SENSOR}`,
    };
  }
  return frase;
}

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
