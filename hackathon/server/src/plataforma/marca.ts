import { readFileSync } from "node:fs";
import { type Marca, parsearMarca } from "../dominio/marca.ts";

const RUTA_POR_DEFECTO = new URL("../../config/marca.json", import.meta.url);

export function cargarMarca(ruta: URL | string = RUTA_POR_DEFECTO): Marca {
  return parsearMarca(JSON.parse(readFileSync(ruta, "utf8")));
}
