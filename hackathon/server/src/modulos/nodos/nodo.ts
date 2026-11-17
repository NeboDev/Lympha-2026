import { ObjectId } from "mongodb";
import { type Catalogo, parametroDe } from "../../dominio/catalogo.ts";
import type { MapeoPines, NodoDoc } from "./tipos.ts";

/**
 * Mapeo por defecto de la plantilla `Atl-Nodo` (ARQUITECTURA.md §4.1). Los pines de los parámetros
 * medibles salen del catálogo; los de estado y diagnóstico son de la plantilla.
 */
export function mapeoPorDefecto(catalogo: Catalogo, parametros: string[]): MapeoPines {
  const valores: Record<string, string> = {};
  const crudos: Record<string, string> = {};
  for (const id of parametros) {
    const p = parametroDe(catalogo, id);
    if (!p.medible || !p.blynk) throw new Error(`El parámetro «${id}» no se puede medir`);
    valores[id] = p.blynk.pin.toLowerCase();
    if (p.blynk.crudo) crudos[id] = p.blynk.crudo.toLowerCase();
  }
  return {
    valores,
    crudos,
    estado: "v4",
    estable: "v5",
    seq: "v6",
    bomba: "v8",
    modo: "v9",
    cal_pct: "v10",
  };
}

export type DatosNodoNuevo = {
  comunidadId: ObjectId;
  nombre: string;
  tokenCifrado: string;
  host: string;
  catalogo: Catalogo;
  parametros?: string[];
  ahora?: Date;
};

/** Documento de un nodo nuevo (sin `ultimo`: aún no ha enviado datos). */
export function crearDocumentoNodo(d: DatosNodoNuevo): NodoDoc {
  const parametros = d.parametros ?? ["ph"];
  return {
    _id: new ObjectId(),
    comunidad_id: d.comunidadId,
    nombre: d.nombre,
    blynk: {
      host: d.host,
      token_cifrado: d.tokenCifrado,
      plantilla: "Atl-Nodo",
      mapeo: mapeoPorDefecto(d.catalogo, parametros),
    },
    parametros,
    ultimo: null,
    creado: d.ahora ?? new Date(),
  };
}
