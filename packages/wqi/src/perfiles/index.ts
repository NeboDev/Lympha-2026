import { type ConfigPerfil, PARAMETROS } from "../tipos.ts";
import { perfilCisterna } from "./cisterna.ts";

/** Perfiles con curvas definidas. Los demás (beber, alberca, riego) llegan cuando haya quien los valide. */
const PERFILES: Readonly<Record<string, ConfigPerfil>> = {
  [perfilCisterna.id]: perfilCisterna,
};

export function obtenerPerfil(id: string): ConfigPerfil | undefined {
  return PERFILES[id];
}

export const idsDePerfiles = (): string[] => Object.keys(PERFILES);

/**
 * Revisa que una configuración sea coherente: quien reemplace las curvas del perfil la corre (hay una
 * prueba que lo hace) y se entera de un orden roto o de pesos que no suman 1 antes de producción.
 * Devuelve la lista de problemas; vacía si todo está bien.
 */
export function validarPerfil(perfil: ConfigPerfil): string[] {
  const problemas: string[] = [];
  let pesos = 0;
  for (const p of PARAMETROS) {
    const c = perfil.parametros[p];
    pesos += c.peso;
    if (c.peso <= 0) problemas.push(`${p}: el peso debe ser positivo`);
    if (c.curva.length < 2) problemas.push(`${p}: la curva necesita al menos dos puntos`);
    for (let i = 0; i < c.curva.length; i++) {
      const punto = c.curva[i] as readonly [number, number];
      if (punto[1] < 0 || punto[1] > 100)
        problemas.push(`${p}: puntaje fuera de 0–100 en el punto ${i}`);
      const anterior = c.curva[i - 1];
      if (anterior && punto[0] <= anterior[0])
        problemas.push(`${p}: los valores de la curva deben crecer (punto ${i})`);
    }
    if (c.rangoFisico[0] >= c.rangoFisico[1]) problemas.push(`${p}: rango físico inválido`);
    const [min, max] = c.rangoFisico;
    for (const [valor] of c.curva) {
      if (valor < min || valor > max)
        problemas.push(`${p}: el punto ${valor} de la curva está fuera del rango físico`);
    }
  }
  if (Math.abs(pesos - 1) > 1e-9) problemas.push(`los pesos suman ${pesos}, deben sumar 1`);
  const u = perfil.umbrales;
  if (!(u.buena > u.regular && u.regular > u.mala && u.mala > 0 && u.buena <= 100)) {
    problemas.push(
      "los umbrales deben ser decrecientes (buena > regular > mala > 0 y buena ≤ 100)",
    );
  }
  if (perfil.ventana.medianaDe > perfil.ventana.tamano)
    problemas.push("medianaDe no puede superar el tamaño de la ventana");
  if (perfil.confianza.lecturasCongelado > perfil.ventana.tamano)
    problemas.push("lecturasCongelado no puede superar el tamaño de la ventana");
  if (perfil.ventana.minimoLecturas > perfil.ventana.tamano)
    problemas.push("minimoLecturas no puede superar el tamaño de la ventana");
  if (perfil.pesoMinimoValido <= 0 || perfil.pesoMinimoValido > 1)
    problemas.push("pesoMinimoValido debe estar entre 0 y 1");
  return problemas;
}
