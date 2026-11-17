import { readFileSync } from "node:fs";

/**
 * Lee un SVG de trazos (los logos de Lympha son solo `<path>` con relleno) para dibujarlo con
 * pdfkit, que acepta datos de path SVG (`doc.path(d)`). Sin librería de SVG: no se soporta más.
 */

export type TrazoSvg = { d: string; relleno: string; regla: "evenodd" | "nonzero" };
export type LogoSvg = {
  x: number;
  y: number;
  ancho: number;
  alto: number;
  trazos: TrazoSvg[];
};

const atributo = (etiqueta: string, nombre: string): string | null =>
  new RegExp(`\\s${nombre}="([^"]*)"`).exec(etiqueta)?.[1] ?? null;

export function parsearSvg(texto: string): LogoSvg {
  const svg = /<svg\b[^>]*>/.exec(texto)?.[0];
  const viewBox = svg ? atributo(svg, "viewBox") : null;
  const num = viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (num?.length !== 4 || num.some((n) => !Number.isFinite(n)) || (num[2] ?? 0) <= 0) {
    throw new Error("SVG inválido: falta un viewBox válido");
  }
  const trazos: TrazoSvg[] = [];
  for (const m of texto.matchAll(/<path\b[^>]*>/g)) {
    const etiqueta = m[0];
    const d = atributo(etiqueta, "d");
    const relleno = atributo(etiqueta, "fill");
    if (!d || !relleno || !/^#[0-9a-fA-F]{6}$/.test(relleno)) {
      throw new Error("SVG no soportado: cada <path> necesita d y un fill #rrggbb");
    }
    trazos.push({
      d,
      relleno,
      regla: atributo(etiqueta, "fill-rule") === "evenodd" ? "evenodd" : "nonzero",
    });
  }
  if (trazos.length === 0) throw new Error("SVG inválido: no tiene trazos");
  return {
    x: num[0] as number,
    y: num[1] as number,
    ancho: num[2] as number,
    alto: num[3] as number,
    trazos,
  };
}

const CARPETA = new URL("../../assets/marca/", import.meta.url);

/** Símbolo de Lympha (copiado de `apps/web/src/assets`; ver `docs/decisiones.md`). */
export function cargarSimboloLympha(): LogoSvg {
  return parsearSvg(readFileSync(new URL("lympha-simbolo.svg", CARPETA), "utf8"));
}
