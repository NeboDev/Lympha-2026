import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { Marca } from "../../dominio/marca.ts";
import {
  BaseFalsa,
  catalogoDePrueba,
  loggerDePrueba,
  nodoDePrueba,
  T0,
} from "../../test/falsos.ts";
import type { Estado } from "../evaluacion/index.ts";
import type { DetalleParametro, UltimoNodo } from "../nodos/index.ts";
import { crearAlertas } from "./index.ts";

const MIN = 60_000;

function entorno(opciones: { vinculado?: boolean; marca?: Partial<Marca> } = {}) {
  const base = new BaseFalsa();
  const nodo = base.agregarNodo(nodoDePrueba(new ObjectId(), "Tinaco azotea"), "Primaria X");
  if (opciones.vinculado !== false) base.vincularFalso(nodo.comunidad_id, 555);
  let ahora = T0;
  const { logs, logger } = loggerDePrueba();
  const alertas = crearAlertas({
    almacen: base,
    catalogo: catalogoDePrueba,
    marca: {
      nombre: "Atl",
      nombre_bot: "Lympha-HP26",
      alarma_local_en_avisos: false,
      dosificacion_automatica: false,
      ...opciones.marca,
    },
    recordatorioMin: 30,
    reloj: () => new Date(ahora),
    logger,
  });

  async function aplicar(
    estado: Estado,
    extra: {
      v?: number;
      cambio?: number;
      cambioRapido?: boolean;
      sinDatos?: boolean;
      ultimoCambioMin?: number;
    } = {},
  ) {
    const detalle: DetalleParametro = {
      cambio_rapido: extra.cambioRapido ?? false,
      cambio: extra.cambio ?? null,
      motivos_sensor: estado === "revisar_sensor" ? ["riel"] : [],
    };
    const ultimo: UltimoNodo = {
      ts: new Date(ahora),
      v: { ph: extra.v ?? 7.1 },
      estado,
      estados: { ph: estado },
      detalles: { ph: detalle },
      seq: 1,
      sesion: 0,
      estable: true,
      ultimo_cambio: new Date(ahora - (extra.ultimoCambioMin ?? 0) * MIN),
      sin_datos: extra.sinDatos ?? false,
    };
    base.ultimos.set(nodo._id.toHexString(), ultimo);
    await alertas.sincronizar({ nodo, ultimo, ahora: new Date(ahora) });
  }

  return {
    base,
    nodo,
    alertas,
    logs,
    aplicar,
    avanzarMin: (m: number) => {
      ahora += m * MIN;
    },
    textos: () => base.avisos.map((a) => a.texto),
    tipos: () => base.avisos.map((a) => a.tipo),
    eventos: () => base.eventos.map((e) => e.tipo),
  };
}

describe("abrir", () => {
  it("fuera de rango abre una alerta, registra el evento y encola un aviso", async () => {
    const e = entorno();
    await e.aplicar("fuera_de_rango", { v: 6.2 });
    expect(e.base.alertas).toHaveLength(1);
    expect(e.base.alertas[0]).toMatchObject({
      tipo: "nivel",
      parametro: "ph",
      severidad: "alta",
      estado: "abierta",
      valor_apertura: 6.2,
    });
    expect(e.base.alertas[0]?.ultimo_aviso).not.toBeNull();
    expect(e.eventos()).toEqual(["alerta_abre"]);
    expect(e.base.avisos).toHaveLength(1);
    const aviso = e.base.avisos[0];
    expect(aviso?.tipo).toBe("abre");
    expect(aviso?.clave).toBe(`${e.base.alertas[0]?._id.toHexString()}:abre`);
    expect(aviso?.texto).toContain("salió del rango recomendado");
    expect(aviso?.texto).toContain("«Tinaco azotea»");
    expect(aviso?.texto).toContain("El pH está en 6.20 (lo normal va de 6.5 a 8.5)");
  });

  it("es idempotente: la misma foto dos veces no duplica alerta, evento ni aviso", async () => {
    const e = entorno();
    await e.aplicar("fuera_de_rango", { v: 6.2 });
    await e.aplicar("fuera_de_rango", { v: 6.2 });
    await e.aplicar("fuera_de_rango", { v: 6.1 });
    expect(e.base.alertas).toHaveLength(1);
    expect(e.base.avisos).toHaveLength(1);
    expect(e.eventos()).toEqual(["alerta_abre"]);
  });

  it("en rango y atención por cercanía no abren nada", async () => {
    const e = entorno();
    await e.aplicar("en_rango");
    await e.aplicar("atencion", { v: 6.6 });
    expect(e.base.alertas).toHaveLength(0);
    expect(e.base.avisos).toHaveLength(0);
  });

  it("un pH alto agrega la línea de efectividad del cloro; uno bajo no", async () => {
    const alto = entorno();
    await alto.aplicar("fuera_de_rango", { v: 8.9 });
    expect(alto.textos()[0]).toContain("el cloro libre actúa con menos fuerza");
    expect(alto.textos()[0]).toContain("~");

    const bajo = entorno();
    await bajo.aplicar("fuera_de_rango", { v: 6.2 });
    expect(bajo.textos()[0]).not.toContain("cloro");
  });

  it("el aviso crítico solo dice «detuvimos la dosificación» si esa función existe", async () => {
    const sin = entorno();
    await sin.aplicar("critico", { v: 5.1 });
    expect(sin.textos()[0]).toContain("muy fuera de rango");
    expect(sin.textos()[0]).not.toMatch(/dosificaci/i);

    const con = entorno({ marca: { dosificacion_automatica: true } });
    await con.aplicar("critico", { v: 5.1 });
    expect(con.textos()[0]).toContain("Detuvimos la dosificación");
  });
});

describe("escalar y bajar", () => {
  it("de fuera de rango a crítico: un aviso de escalada, una sola vez", async () => {
    const e = entorno();
    await e.aplicar("fuera_de_rango", { v: 6.2 });
    await e.aplicar("critico", { v: 5.2 });
    await e.aplicar("critico", { v: 5.1 });
    expect(e.tipos()).toEqual(["abre", "escala"]);
    expect(e.base.alertas[0]).toMatchObject({ severidad: "critica", severidad_maxima: "critica" });
    expect(e.base.avisos[1]?.texto).toContain("muy fuera de rango");
    expect(e.base.avisos[1]?.clave).toMatch(/:escala:critica$/);
    expect(e.base.alertas).toHaveLength(1);
  });

  it("de crítico a fuera de rango: se actualiza sin avisar y recuerda el máximo alcanzado", async () => {
    const e = entorno();
    await e.aplicar("critico", { v: 5.2 });
    await e.aplicar("fuera_de_rango", { v: 6.1 });
    expect(e.tipos()).toEqual(["abre"]);
    expect(e.base.alertas[0]).toMatchObject({ severidad: "alta", severidad_maxima: "critica" });
  });
});

describe("cerrar", () => {
  it("al volver al rango cierra, registra el evento y avisa la recuperación con su duración", async () => {
    const e = entorno();
    await e.aplicar("fuera_de_rango", { v: 6.2 });
    e.avanzarMin(18);
    await e.aplicar("en_rango", { v: 7.1 });
    expect(e.base.alertas[0]).toMatchObject({ estado: "cerrada", valor_cierre: 7.1 });
    expect(e.eventos()).toEqual(["alerta_abre", "alerta_cierra"]);
    expect(e.tipos()).toEqual(["abre", "cierra"]);
    expect(e.textos()[1]).toContain("volvió al rango (7.10)");
    expect(e.textos()[1]).toContain("La alerta duró 18 minutos");
  });

  it("repetir el cierre no manda otro aviso", async () => {
    const e = entorno();
    await e.aplicar("fuera_de_rango", { v: 6.2 });
    await e.aplicar("en_rango");
    await e.aplicar("en_rango");
    expect(e.tipos()).toEqual(["abre", "cierra"]);
  });

  it("permite abrir otra alerta nueva después de cerrar la anterior", async () => {
    const e = entorno();
    await e.aplicar("fuera_de_rango", { v: 6.2 });
    await e.aplicar("en_rango");
    await e.aplicar("fuera_de_rango", { v: 6.3 });
    expect(e.base.alertas).toHaveLength(2);
    expect(e.base.alertas.filter((a) => a.estado === "abierta")).toHaveLength(1);
    expect(e.tipos()).toEqual(["abre", "cierra", "abre"]);
  });
});

describe("cambio rápido", () => {
  it("abre una alerta informativa y, si el agua sale de rango, la cierra sin decir «se estabilizó»", async () => {
    const e = entorno();
    await e.aplicar("atencion", { v: 7.6, cambio: 0.62, cambioRapido: true });
    expect(e.base.alertas[0]).toMatchObject({ tipo: "cambio_rapido", severidad: "atencion" });
    expect(e.textos()[0]).toContain("cambió 0.62 en 5 minutos");

    await e.aplicar("fuera_de_rango", { v: 8.7 });
    expect(e.base.alertas.map((a) => [a.tipo, a.estado])).toEqual([
      ["cambio_rapido", "cerrada"],
      ["nivel", "abierta"],
    ]);
    // Avisos: el del cambio rápido y el del nivel; ningún «se estabilizó» falso.
    expect(e.tipos()).toEqual(["abre", "abre"]);
    expect(e.textos().join(" ")).not.toContain("se estabilizó");
  });

  it("cuando se calma, avisa que se estabilizó", async () => {
    const e = entorno();
    await e.aplicar("atencion", { v: 7.6, cambio: 0.62, cambioRapido: true });
    e.avanzarMin(6);
    await e.aplicar("en_rango", { v: 7.2 });
    expect(e.tipos()).toEqual(["abre", "cierra"]);
    expect(e.textos()[1]).toContain("se estabilizó");
  });
});

describe("sensor", () => {
  it("abre «revisar sensor» y al recuperarse avisa que la lectura vuelve a ser confiable", async () => {
    const e = entorno();
    await e.aplicar("revisar_sensor", { v: 14 });
    expect(e.base.alertas[0]).toMatchObject({ tipo: "sensor", severidad: "alta" });
    expect(e.textos()[0]).toContain("no es confiable");
    e.avanzarMin(10);
    await e.aplicar("en_rango", { v: 7.2 });
    expect(e.textos()[1]).toContain("volvió a ser confiable");
  });
});

describe("sin conexión", () => {
  it("abre «sin conexión» y no cierra las alertas del agua mientras el nodo está detenido", async () => {
    const e = entorno();
    await e.aplicar("fuera_de_rango", { v: 6.2 });
    e.avanzarMin(2);
    await e.aplicar("fuera_de_rango", { v: 6.2, sinDatos: true, ultimoCambioMin: 2 });
    const abiertas = e.base.alertas.filter((a) => a.estado === "abierta").map((a) => a.tipo);
    expect(abiertas.sort()).toEqual(["nivel", "sin_conexion"]);
    expect(e.textos()[1]).toContain("No recibimos datos de «Tinaco azotea» desde hace 2 minutos");
    expect(e.textos()[1]).not.toContain("alarma local");
  });

  it("al reconectarse cierra «sin conexión» y juzga el agua con datos frescos", async () => {
    const e = entorno();
    await e.aplicar("fuera_de_rango", { v: 6.2 });
    await e.aplicar("fuera_de_rango", { v: 6.2, sinDatos: true, ultimoCambioMin: 3 });
    e.avanzarMin(5);
    await e.aplicar("en_rango", { v: 7.1 });
    expect(e.base.alertas.every((a) => a.estado === "cerrada")).toBe(true);
    expect(e.textos().some((t) => t.includes("volvió a enviar datos"))).toBe(true);
    expect(e.textos().some((t) => t.includes("volvió al rango"))).toBe(true);
  });

  it("dice «alarma local» solo si la marca lo confirma", async () => {
    const e = entorno({ marca: { alarma_local_en_avisos: true } });
    await e.aplicar("en_rango", { sinDatos: true, ultimoCambioMin: 2 });
    expect(e.textos()[0]).toContain("La alarma local sigue funcionando");
  });
});

describe("sin Telegram vinculado", () => {
  it("guarda la alerta y el evento, pero no encola avisos; el cierre tampoco avisa", async () => {
    const e = entorno({ vinculado: false });
    await e.aplicar("fuera_de_rango", { v: 6.2 });
    expect(e.base.alertas[0]?.ultimo_aviso).toBeNull();
    expect(e.eventos()).toEqual(["alerta_abre"]);
    expect(e.base.avisos).toHaveLength(0);
    await e.aplicar("en_rango");
    expect(e.eventos()).toEqual(["alerta_abre", "alerta_cierra"]);
    expect(e.base.avisos).toHaveLength(0);
  });

  it("al vincular después, el barrido manda el aviso de lo que sigue abierto", async () => {
    const e = entorno({ vinculado: false });
    await e.aplicar("fuera_de_rango", { v: 6.2 });
    expect((await e.alertas.barrido()).avisos).toBe(0);
    e.base.vincularFalso(e.nodo.comunidad_id, 555);
    expect((await e.alertas.barrido()).avisos).toBe(1);
    expect(e.tipos()).toEqual(["abre"]);
    expect(e.textos()[0]).toContain("salió del rango recomendado");
    // Una segunda pasada no repite.
    expect((await e.alertas.barrido()).avisos).toBe(0);
  });

  it("si el proceso muere entre abrir la alerta y encolar el aviso, el barrido lo recupera", async () => {
    const e = entorno();
    const original = e.base.encolarAviso.bind(e.base);
    let fallar = true;
    e.base.encolarAviso = async (a) => {
      if (fallar) {
        fallar = false;
        throw new Error("Mongo caído");
      }
      return original(a);
    };
    await expect(e.aplicar("fuera_de_rango", { v: 6.2 })).rejects.toThrow("Mongo caído");
    expect(e.base.alertas).toHaveLength(1);
    expect(e.base.avisos).toHaveLength(0);
    // El reintento de la ingesta no duplica la alerta, y el barrido manda el aviso que faltaba.
    await e.aplicar("fuera_de_rango", { v: 6.2 });
    expect(e.base.alertas).toHaveLength(1);
    expect((await e.alertas.barrido()).avisos).toBe(1);
    expect(e.tipos()).toEqual(["abre"]);
  });
});

describe("recordatorios (barrido)", () => {
  it("recuerda cada 30 min con la duración, y no antes", async () => {
    const e = entorno();
    await e.aplicar("fuera_de_rango", { v: 6.2 });
    e.avanzarMin(29);
    expect((await e.alertas.barrido()).avisos).toBe(0);
    e.avanzarMin(1);
    expect((await e.alertas.barrido()).avisos).toBe(1);
    expect(e.tipos()).toEqual(["abre", "recordatorio"]);
    expect(e.textos()[1]).toContain("Lleva 30 minutos activa");
    expect(e.base.avisos[1]?.clave).toMatch(/:rec:1$/);
    expect(e.base.alertas[0]?.recordatorios).toBe(1);

    // Dos pasadas seguidas en el mismo instante no repiten el recordatorio.
    expect((await e.alertas.barrido()).avisos).toBe(0);
    e.avanzarMin(30);
    expect((await e.alertas.barrido()).avisos).toBe(1);
    expect(e.base.avisos[2]?.clave).toMatch(/:rec:2$/);
    expect(e.textos()[2]).toContain("Lleva 1 hora activa");
  });

  it("las críticas recuerdan a la mitad del tiempo", async () => {
    const e = entorno();
    await e.aplicar("critico", { v: 5.1 });
    e.avanzarMin(15);
    expect((await e.alertas.barrido()).avisos).toBe(1);
  });

  it("el recordatorio usa la lectura actual, no la de apertura", async () => {
    const e = entorno();
    await e.aplicar("fuera_de_rango", { v: 6.2 });
    e.avanzarMin(30);
    await e.aplicar("fuera_de_rango", { v: 6.4 });
    await e.alertas.barrido();
    expect(e.textos()[1]).toContain("está en 6.40");
  });

  it("los cambios rápidos no generan recordatorios", async () => {
    const e = entorno();
    await e.aplicar("atencion", { v: 7.6, cambio: 0.7, cambioRapido: true });
    e.avanzarMin(120);
    expect((await e.alertas.barrido()).avisos).toBe(0);
  });

  it("las alertas cerradas no recuerdan", async () => {
    const e = entorno();
    await e.aplicar("fuera_de_rango", { v: 6.2 });
    await e.aplicar("en_rango");
    e.avanzarMin(120);
    expect((await e.alertas.barrido()).avisos).toBe(0);
  });
});
