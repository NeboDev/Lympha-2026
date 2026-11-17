import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import type { Catalogo } from "../../dominio/catalogo.ts";
import { ErrorDominio } from "../../dominio/errores.ts";
import type { Marca } from "../../dominio/marca.ts";
import { type ContenidoReporte, construirContenido } from "./contenido.ts";
import type { AlmacenReportes, ReporteDoc } from "./puertos.ts";

/** Un reporte que no se puede armar: el nodo no existe o el periodo no vale. La API lo traduce a HTTP. */
export class ErrorReporte extends ErrorDominio {
  constructor(codigo: "nodo_inexistente" | "periodo_invalido", mensaje: string) {
    super(codigo === "nodo_inexistente" ? 404 : 422, codigo, mensaje);
  }
}

export type ReporteGenerado = {
  id: string;
  generado: Date;
  generadoPor: string;
  /** «sha256:…» del contenido (datos y periodo). Sirve para comprobar que los datos no cambiaron. */
  hash: string;
  contenido: ContenidoReporte;
};

export type OpcionesReportes = {
  almacen: AlmacenReportes;
  catalogo: Catalogo;
  marca: Marca;
  reloj?: () => Date;
};

const DIA_MS = 86_400_000;

/** Huella del contenido: no incluye el id ni la hora de generación, así que es estable. */
export function huellaDe(contenido: ContenidoReporte): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(contenido)).digest("hex")}`;
}

export function crearServicioReportes(op: OpcionesReportes) {
  const reloj = op.reloj ?? (() => new Date());
  const { dias_max } = op.catalogo.reporte;

  /** Genera el contenido del reporte de un nodo y guarda su resumen. No dibuja el PDF. */
  async function generar(p: {
    nodoId: ObjectId;
    desde: Date;
    hasta: Date;
    generadoPor: string;
  }): Promise<ReporteGenerado> {
    const generado = reloj();
    // Un periodo no puede terminar en el futuro: ahí todavía no hay datos y bajaría la cobertura.
    const hasta = new Date(Math.min(p.hasta.getTime(), generado.getTime()));
    if (!(p.desde < hasta)) {
      throw new ErrorReporte("periodo_invalido", "El periodo debe empezar antes de terminar.");
    }
    if (hasta.getTime() - p.desde.getTime() > dias_max * DIA_MS) {
      throw new ErrorReporte("periodo_invalido", `El periodo no puede pasar de ${dias_max} días.`);
    }

    const nodo = await op.almacen.nodo(p.nodoId);
    if (!nodo) throw new ErrorReporte("nodo_inexistente", "El nodo no existe.");
    const comunidad = await op.almacen.comunidad(nodo.comunidad_id);
    if (!comunidad) throw new ErrorReporte("nodo_inexistente", "La comunidad del nodo no existe.");

    const [muestras, alertas, eventos, calibraciones] = await Promise.all([
      op.almacen.muestras(nodo._id, p.desde, hasta),
      op.almacen.alertas(nodo._id, p.desde, hasta),
      op.almacen.eventos(nodo.comunidad_id, nodo._id, p.desde, hasta),
      op.almacen.calibraciones(nodo._id, p.desde, hasta),
    ]);

    const contenido = construirContenido({
      marca: op.marca.nombre,
      comunidad: comunidad.nombre,
      nodo,
      desde: p.desde,
      hasta,
      muestras,
      alertas,
      eventos,
      calibraciones,
      catalogo: op.catalogo,
    });
    const hash = huellaDe(contenido);
    const id = new ObjectId();

    const doc: ReporteDoc = {
      _id: id,
      nodo_id: nodo._id,
      comunidad_id: nodo.comunidad_id,
      desde: p.desde,
      hasta,
      generado,
      generado_por: p.generadoPor,
      resumen: {
        parametros: Object.fromEntries(
          contenido.parametros.map((q) => [
            q.id,
            {
              prom: q.estadisticas.promedio,
              min: q.estadisticas.minimo,
              max: q.estadisticas.maximo,
              pct_en_rango: q.estadisticas.pctEnRango,
              n: q.estadisticas.n,
            },
          ]),
        ),
        cobertura_pct: contenido.coberturaPct,
        alertas: contenido.alertasTotal,
      },
      hash,
    };
    await op.almacen.guardarReporte(doc);
    return { id: id.toHexString(), generado, generadoPor: p.generadoPor, hash, contenido };
  }

  /** Atajo: los últimos `dias` días hasta ahora. */
  function ultimosDias(nodoId: ObjectId, dias: number, generadoPor: string) {
    const hasta = reloj();
    return generar({
      nodoId,
      desde: new Date(hasta.getTime() - dias * DIA_MS),
      hasta,
      generadoPor,
    });
  }

  return { generar, ultimosDias };
}

export type ServicioReportes = ReturnType<typeof crearServicioReportes>;
