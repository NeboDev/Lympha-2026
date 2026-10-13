import type { ConfigPerfil } from "../tipos.ts";

/**
 * Perfil CISTERNA / doméstico — TODOS los valores de este perfil viven en este archivo.
 *
 * ⚠ PROVISIONAL (0.1-provisional). Las curvas todavía no las valida un especialista. Se armaron a
 * partir de los límites permisibles de la NOM-127-SSA1 (agua para uso y consumo humano) tal como los
 * recuerda el equipo; ANTES DE VALIDAR hay que cotejar cada límite contra el texto vigente de la norma.
 * Que un valor caiga dentro de estos límites NO certifica nada sobre el agua (RNF-32).
 *
 * Cómo reemplazarlo: edita solo los números de aquí (curvas, pesos, umbrales, ventana, histéresis),
 * sube `version` y regenera los casos de referencia (`pnpm --filter @lympha/wqi fixtures`); la prueba
 * de referencia falla si un resultado cambia sin que cambie la versión (RNF-24).
 *
 * Lectura de las curvas: [valor medido, puntaje 0–100]. El puntaje 80 es el borde de "buena": un
 * valor exactamente en el límite de la norma queda justo en el borde; dentro del límite, con margen,
 * llega a 100; pasado el límite baja hasta 0.
 */
export const perfilCisterna = {
  id: "cisterna",
  version: "0.1-provisional",
  estado: "provisional",
  referencias: [
    "NOM-127-SSA1: pH 6.5–8.5 (límite permisible)",
    "NOM-127-SSA1: turbiedad 4 UTN (la edición de 2000 decía 5 UTN) — verificar edición vigente",
    "NOM-127-SSA1: sólidos disueltos totales 1,000 mg/L",
    "Conductividad: la norma no fija un límite; se deriva del de SDT con un factor TDS/CE de ~0.65 (1,000 / 0.65 ≈ 1,500 µS/cm)",
    "Temperatura: la norma no fija un límite; rango de confort provisional con peso bajo y sin poder de veto",
  ],

  parametros: {
    ph: {
      peso: 0.3,
      limita: true,
      curva: [
        [5.0, 0],
        [5.5, 20],
        [6.0, 50],
        [6.5, 80], // límite inferior NOM-127
        [7.0, 100],
        [8.0, 100],
        [8.5, 80], // límite superior NOM-127
        [9.0, 50],
        [9.5, 20],
        [10.0, 0],
      ],
      rangoFisico: [0, 14],
    },
    turbidez: {
      peso: 0.3,
      limita: true,
      curva: [
        [1, 100],
        [4, 80], // límite NOM-127 (UTN ≈ NTU)
        [6, 65],
        [8, 50],
        [15, 20],
        [25, 0],
      ],
      rangoFisico: [0, 4000],
    },
    tds: {
      peso: 0.15,
      limita: true,
      curva: [
        [500, 100],
        [1000, 80], // límite NOM-127 (mg/L)
        [1500, 50],
        [2000, 20],
        [3000, 0],
      ],
      rangoFisico: [0, 10000],
    },
    conductividad: {
      peso: 0.15,
      limita: true,
      curva: [
        [750, 100],
        [1500, 80], // equivalente derivado del límite de SDT
        [2250, 50],
        [3000, 20],
        [4500, 0],
      ],
      rangoFisico: [0, 20000],
    },
    temperatura: {
      peso: 0.1, // peso bajo: la norma no la limita
      limita: false, // nunca fuerza por sí sola un nivel peor
      curva: [
        [5, 50],
        [10, 100],
        [28, 100],
        [35, 60],
        [45, 20],
        [60, 0],
      ],
      rangoFisico: [0, 100],
    },
  },

  umbrales: { buena: 80, regular: 60, mala: 40 },
  pesoMinimoValido: 0.5,

  ventana: { tamano: 15, medianaDe: 5, minimoLecturas: 3 },

  histeresis: {
    margen: 3,
    // Empeorar se confirma antes que mejorar: es más caro callar un problema que avisarlo de más.
    confirmarNivel: { empeorar: 3, mejorar: 5 },
    confirmarConfianza: { empeorar: 3, mejorar: 5 },
  },

  confianza: { lecturasCongelado: 10 },
} as const satisfies ConfigPerfil;
