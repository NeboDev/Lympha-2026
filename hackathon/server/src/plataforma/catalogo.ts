import { readFileSync } from "node:fs";
import { type Catalogo, parsearCatalogo } from "../dominio/catalogo.ts";

const RUTA_POR_DEFECTO = new URL("../../config/parametros.json", import.meta.url);

/** Lee y valida `server/config/parametros.json`. Única pieza que toca el disco para el catálogo. */
export function cargarCatalogo(ruta: URL | string = RUTA_POR_DEFECTO): Catalogo {
  return parsearCatalogo(JSON.parse(readFileSync(ruta, "utf8")));
}
