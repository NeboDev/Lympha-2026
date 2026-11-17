import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { Marca } from "../../dominio/marca.ts";
import { catalogoDePrueba, nodoDePrueba, T0 } from "../../test/falsos.ts";
import type { AlertaDoc } from "../alertas/index.ts";
import type {
  AlmacenReportes,
  CalibracionDoc,
  EventoReporte,
  MuestraReporte,
  ReporteDoc,
} from "./puertos.ts";
import { crearServicioReportes, ErrorReporte, huellaDe } from "./servicio.ts";

const marca: Marca = {
  nombre: "Lympha Atl",
  nombre_bot: "Lympha-HP26",
  alarma_local_en_avisos: false,
  dosificacion_automatica: false,
};
const HORA = 3600_000;

function crearBase(opciones: {
  muestras?: MuestraReporte[];
  alertas?: AlertaDoc[];
  eventos?: EventoReporte[];
  calibraciones?: CalibracionDoc[];
}) {
  const comunidadId = new ObjectId();
  const nodo = nodoDePrueba(comunidadId, "Tinaco azotea");
  const guardados: ReporteDoc[] = [];
  const almacen: AlmacenReportes = {
    async nodo(id) {
      return id.equals(nodo._id) ? nodo : null;
    },
    async comunidad(id) {
      return id.equals(comunidadId) ? { _id: comunidadId, nombre: "Primaria X" } : null;
    },
    async muestras() {
      return opciones.muestras ?? [];
    },
    async alertas() {
      return opciones.alertas ?? [];
    },
    async eventos() {
      return opciones.eventos ?? [];
    },
    async calibraciones() {
      return opciones.calibraciones ?? [];
    },
    async guardarReporte(doc) {
      guardados.push(doc);
    },
  };
  return { almacen, nodo, comunidadId, guardados };
}

/** Una muestra por minuto durante `horas` horas, con el pH dado por `ph(i)`. */
function muestras(horas: number, ph: (i: number) => number): MuestraReporte[] {
  const n = horas * 60;
  return Array.from({ length: n }, (_, i) => ({
    ts: new Date(T0 - horas * HORA + i * 60_000),
    v: { ph: ph(i) },
  }));
}

describe("crearServicioReportes", () => {
  it("arma el contenido, guarda el resumen con su huella y devuelve un id", async () => {
    const { almacen, nodo, guardados } = crearBase({ muestras: muestras(2, () => 7) });
    const servicio = crearServicioReportes({
      almacen,
      catalogo: catalogoDePrueba,
      marca,
      reloj: () => new Date(T0),
    });
    const r = await servicio.generar({
      nodoId: nodo._id,
      desde: new Date(T0 - 2 * HORA),
      hasta: new Date(T0),
      generadoPor: "Prueba",
    });

    const ph = r.contenido.parametros.find((p) => p.id === "ph");
    expect(ph?.estadisticas.pctEnRango).toBeCloseTo(100);
    expect(ph?.insignia?.nivel).toBe("bien");
    expect(r.contenido.comunidad).toBe("Primaria X");
    expect(r.contenido.nodo.nombre).toBe("Tinaco azotea");
    expect(r.hash).toMatch(/^sha256:[0-9a-f]{64}$/);

    expect(guardados).toHaveLength(1);
    expect(guardados[0]).toMatchObject({
      generado_por: "Prueba",
      hash: r.hash,
      resumen: { alertas: 0, parametros: { ph: { n: 120, pct_en_rango: expect.any(Number) } } },
    });
    expect(guardados[0]?._id.toHexString()).toBe(r.id);
  });

  it("la huella es la misma con los mismos datos aunque cambie el id, y cambia si cambian los datos", async () => {
    const generar = async (
      valor: number,
      base = crearBase({ muestras: muestras(1, () => valor) }),
    ) => {
      const s = crearServicioReportes({
        almacen: base.almacen,
        catalogo: catalogoDePrueba,
        marca,
        reloj: () => new Date(T0),
      });
      return s.generar({
        nodoId: base.nodo._id,
        desde: new Date(T0 - HORA),
        hasta: new Date(T0),
        generadoPor: "x",
      });
    };
    const base = crearBase({ muestras: muestras(1, () => 7) });
    const a = await generar(7, base);
    const b = await generar(7, base);
    expect(a.id).not.toBe(b.id);
    expect(b.hash).toBe(a.hash);
    expect(huellaDe(a.contenido)).toBe(a.hash);
    const c = await generar(9, crearBase({ muestras: muestras(1, () => 9) }));
    expect(c.hash).not.toBe(a.hash);
  });

  it("con pH fuera de rango la insignia lo dice y no habla de «cumple»", async () => {
    const { almacen, nodo } = crearBase({
      muestras: muestras(4, (i) => (i < 120 ? 6.0 : 7.0)), // la mitad del tiempo fuera
    });
    const servicio = crearServicioReportes({
      almacen,
      catalogo: catalogoDePrueba,
      marca,
      reloj: () => new Date(T0),
    });
    const r = await servicio.generar({
      nodoId: nodo._id,
      desde: new Date(T0 - 4 * HORA),
      hasta: new Date(T0),
      generadoPor: "x",
    });
    const ph = r.contenido.parametros.find((p) => p.id === "ph");
    expect(ph?.insignia?.nivel).toBe("fuera");
    expect(ph?.insignia?.texto).toMatch(/solo el 50\.\d % del tiempo con datos/);
    expect(r.contenido.resumen.join(" ")).not.toMatch(/cumple|potable|segur/i);
  });

  it("sin datos suficientes la insignia no da un porcentaje engañoso", async () => {
    const { almacen, nodo } = crearBase({ muestras: muestras(1, () => 7) });
    const servicio = crearServicioReportes({
      almacen,
      catalogo: catalogoDePrueba,
      marca,
      reloj: () => new Date(T0),
    });
    // Se pide una semana pero solo hay 1 hora de datos: cobertura ≈ 0.6 %.
    const r = await servicio.generar({
      nodoId: nodo._id,
      desde: new Date(T0 - 7 * 24 * HORA),
      hasta: new Date(T0),
      generadoPor: "x",
    });
    const ph = r.contenido.parametros.find((p) => p.id === "ph");
    expect(ph?.insignia?.nivel).toBe("sin_datos");
    expect(ph?.insignia?.texto).toContain("no hay datos suficientes");
    expect(r.contenido.resumen.join(" ")).toContain("no describen todo el periodo");
  });

  it("lista lo que no se midió, sin inventar límites por confirmar", async () => {
    const { almacen, nodo } = crearBase({ muestras: muestras(1, () => 7) });
    const servicio = crearServicioReportes({
      almacen,
      catalogo: catalogoDePrueba,
      marca,
      reloj: () => new Date(T0),
    });
    const r = await servicio.ultimosDias(nodo._id, 1, "x");
    expect(r.contenido.noMedidos.map((n) => n.nombre)).toEqual(
      expect.arrayContaining(["Cloro residual libre", "Turbidez"]),
    );
    expect(r.contenido.noMedidos.map((n) => n.nombre)).not.toContain("pH");
  });

  it("junta alertas y eventos en orden, y separa la bitácora", async () => {
    const nodoDoc = crearBase({});
    const alerta: AlertaDoc = {
      _id: new ObjectId(),
      nodo_id: nodoDoc.nodo._id,
      comunidad_id: nodoDoc.comunidadId,
      tipo: "nivel",
      parametro: "ph",
      severidad: "critica",
      severidad_maxima: "critica",
      estado: "cerrada",
      abierta: new Date(T0 - 3 * HORA),
      cerrada: new Date(T0 - 3 * HORA + 18 * 60_000),
      ultimo_aviso: null,
      recordatorios: 0,
      valor_apertura: 5.2,
      valor_cierre: 7,
    };
    const { almacen, nodo } = crearBase({
      alertas: [alerta],
      eventos: [
        {
          ts: new Date(T0 - 5 * HORA),
          tipo: "sin_datos",
          mensaje: "El nodo dejó de enviar datos.",
        },
        { ts: new Date(T0 - 2 * HORA), tipo: "bitacora", mensaje: "Se lavó el tinaco." },
      ],
      calibraciones: [
        {
          _id: new ObjectId(),
          nodo_id: new ObjectId(),
          ts: new Date(T0 - 6 * HORA),
          parametro: "ph",
          pendiente_pct_nernst: 98.12,
          offset_mv: 3,
          diagnostico: "buena",
        },
      ],
    });
    const servicio = crearServicioReportes({
      almacen,
      catalogo: catalogoDePrueba,
      marca,
      reloj: () => new Date(T0),
    });
    const r = await servicio.ultimosDias(nodo._id, 1, "x");
    expect(r.contenido.eventos.map((e) => e.titulo)).toEqual(["Nodo sin datos", "pH crítico"]);
    expect(r.contenido.eventos[1]?.detalle).toBe("Duró 18 minutos · valor al abrir 5.20");
    expect(r.contenido.bitacora).toEqual([
      { ts: new Date(T0 - 2 * HORA), texto: "Se lavó el tinaco." },
    ]);
    expect(r.contenido.calibraciones[0]).toMatchObject({
      parametro: "pH",
      pendiente: "98.1 % de Nernst",
      offset: "3.0 mV",
      diagnostico: "Buena",
    });
    expect(r.contenido.alertasTotal).toBe(1);
    expect(r.contenido.resumen.join(" ")).toContain("la más grave fue de severidad crítica");
  });

  it("rechaza nodos inexistentes y periodos inválidos con errores tipados", async () => {
    const { almacen, nodo } = crearBase({});
    const servicio = crearServicioReportes({
      almacen,
      catalogo: catalogoDePrueba,
      marca,
      reloj: () => new Date(T0),
    });
    await expect(servicio.ultimosDias(new ObjectId(), 1, "x")).rejects.toMatchObject({
      codigo: "nodo_inexistente",
    });
    await expect(
      servicio.generar({
        nodoId: nodo._id,
        desde: new Date(T0),
        hasta: new Date(T0 - HORA),
        generadoPor: "x",
      }),
    ).rejects.toBeInstanceOf(ErrorReporte);
    await expect(servicio.ultimosDias(nodo._id, 91, "x")).rejects.toMatchObject({
      codigo: "periodo_invalido",
    });
  });

  it("un periodo que termina en el futuro se recorta a ahora", async () => {
    const { almacen, nodo } = crearBase({ muestras: muestras(1, () => 7) });
    const servicio = crearServicioReportes({
      almacen,
      catalogo: catalogoDePrueba,
      marca,
      reloj: () => new Date(T0),
    });
    const r = await servicio.generar({
      nodoId: nodo._id,
      desde: new Date(T0 - HORA),
      hasta: new Date(T0 + 10 * HORA),
      generadoPor: "x",
    });
    expect(r.contenido.hasta).toEqual(new Date(T0));
  });
});
