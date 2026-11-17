import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { textosBot } from "../../dominio/frases.ts";
import type { Marca } from "../../dominio/marca.ts";
import {
  BaseFalsa,
  catalogoDePrueba,
  loggerDePrueba,
  nodoDePrueba,
  T0,
} from "../../test/falsos.ts";
import type { UltimoNodo } from "../nodos/index.ts";
import {
  type ActualizacionBot,
  crearManejadorTelegram,
  crearTokenVinculo,
  enlaceDeVinculo,
  type GeneradorReporte,
} from "./index.ts";

const marca: Marca = {
  nombre: "Lympha Atl",
  nombre_bot: "Lympha-HP26",
  alarma_local_en_avisos: false,
  dosificacion_automatica: false,
};
const T = textosBot(marca);

type Generar = GeneradorReporte["generar"];

function escenario(opciones: { generar?: Generar } = {}) {
  const base = new BaseFalsa();
  const nodo = base.agregarNodo(nodoDePrueba(new ObjectId(), "Tinaco azotea"), "Primaria X");
  const enviados: { chat: number; texto: string }[] = [];
  const documentos: { chat: number; nombre: string; bytes: number; leyenda?: string }[] = [];
  let fallaEnvio = false;
  let ahora = T0;
  const { logs, logger } = loggerDePrueba();
  const manejar = crearManejadorTelegram({
    almacen: base,
    cliente: {
      async enviarMensaje(chat, texto) {
        if (fallaEnvio) throw new Error("sin red");
        enviados.push({ chat, texto });
      },
      async enviarDocumento(chat, archivo, leyenda) {
        if (fallaEnvio) throw new Error("sin red");
        documentos.push({
          chat,
          nombre: archivo.nombre,
          bytes: archivo.contenido.length,
          ...(leyenda === undefined ? {} : { leyenda }),
        });
      },
    },
    ...(opciones.generar ? { reportes: { generar: opciones.generar } } : {}),
    marca,
    catalogo: catalogoDePrueba,
    usuarioBot: "lympha26_bot",
    reloj: () => new Date(ahora),
    logger,
  });
  let n = 0;
  const mensaje = (
    texto: string,
    chat: { id: number; type?: string; title?: string } = { id: 100, type: "private" },
    desde: number | null = 42,
  ): ActualizacionBot => ({
    update_id: ++n,
    message: { text: texto, chat, ...(desde === null ? {} : { from: { id: desde } }) },
  });
  return {
    base,
    nodo,
    enviados,
    documentos,
    logs,
    manejar,
    mensaje,
    ultimaRespuesta: () => enviados.at(-1)?.texto,
    avanzar: (ms: number) => {
      ahora += ms;
    },
    ahora: () => new Date(ahora),
    romperEnvio: () => {
      fallaEnvio = true;
    },
  };
}

describe("token y enlace de vinculación", () => {
  it("el token es de un solo uso, de 43 caracteres y vence en 10 minutos", async () => {
    const e = escenario();
    const { token, expiraEn } = await crearTokenVinculo(e.base, e.nodo.comunidad_id, new Date(T0));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiraEn.getTime()).toBe(T0 + 10 * 60_000);
    const otro = await crearTokenVinculo(e.base, e.nodo.comunidad_id, new Date(T0));
    expect(otro.token).not.toBe(token);
  });

  it("el enlace usa ?start= para chats privados y ?startgroup= para grupos", () => {
    expect(enlaceDeVinculo("lympha26_bot", "abc")).toBe("https://t.me/lympha26_bot?start=abc");
    expect(enlaceDeVinculo("lympha26_bot", "abc", true)).toBe(
      "https://t.me/lympha26_bot?startgroup=abc",
    );
  });
});

describe("/start <token>", () => {
  it("vincula el chat privado a la comunidad y lo confirma", async () => {
    const e = escenario();
    const { token } = await crearTokenVinculo(e.base, e.nodo.comunidad_id, e.ahora());
    await e.manejar(e.mensaje(`/start ${token}`));
    expect(e.ultimaRespuesta()).toBe(T.vinculado("Primaria X"));
    const c = e.base.comunidades.get(e.nodo.comunidad_id.toHexString());
    expect(c?.telegram).toMatchObject({ chat_id: 100, tipo: "private", vinculado_por: 42 });
  });

  it("vincula un grupo (con /start@bot) y guarda su título y quién lo vinculó", async () => {
    const e = escenario();
    const { token } = await crearTokenVinculo(e.base, e.nodo.comunidad_id, e.ahora());
    await e.manejar(
      e.mensaje(
        `/start@lympha26_bot ${token}`,
        { id: -900, type: "supergroup", title: "Padres 3ºA" },
        77,
      ),
    );
    expect(e.ultimaRespuesta()).toBe(T.vinculado("Primaria X"));
    expect(e.base.comunidades.get(e.nodo.comunidad_id.toHexString())?.telegram).toMatchObject({
      chat_id: -900,
      titulo: "Padres 3ºA",
      vinculado_por: 77,
    });
  });

  it("el token no se puede usar dos veces", async () => {
    const e = escenario();
    const { token } = await crearTokenVinculo(e.base, e.nodo.comunidad_id, e.ahora());
    await e.manejar(e.mensaje(`/start ${token}`));
    await e.manejar(e.mensaje(`/start ${token}`, { id: 200, type: "private" }));
    expect(e.ultimaRespuesta()).toBe(T.vencido);
    expect(e.base.comunidades.get(e.nodo.comunidad_id.toHexString())?.telegram?.chat_id).toBe(100);
  });

  it("un token vencido (más de 10 min) o inventado no vincula nada", async () => {
    const e = escenario();
    const { token } = await crearTokenVinculo(e.base, e.nodo.comunidad_id, e.ahora());
    e.avanzar(10 * 60_000 + 1);
    await e.manejar(e.mensaje(`/start ${token}`));
    expect(e.ultimaRespuesta()).toBe(T.vencido);
    await e.manejar(e.mensaje(`/start ${"x".repeat(43)}`));
    expect(e.ultimaRespuesta()).toBe(T.vencido);
    await e.manejar(e.mensaje("/start corto"));
    expect(e.ultimaRespuesta()).toBe(T.vencido);
    expect(e.base.comunidades.get(e.nodo.comunidad_id.toHexString())?.telegram).toBeNull();
  });

  it("un chat que ya es de otra comunidad no se puede vincular a una segunda", async () => {
    const e = escenario();
    const otro = e.base.agregarNodo(nodoDePrueba(new ObjectId(), "Cisterna"), "Comité del pozo");
    e.base.vincularFalso(otro.comunidad_id, 100);
    const { token } = await crearTokenVinculo(e.base, e.nodo.comunidad_id, e.ahora());
    await e.manejar(e.mensaje(`/start ${token}`));
    expect(e.ultimaRespuesta()).toBe(T.ocupado);
    expect(e.base.comunidades.get(e.nodo.comunidad_id.toHexString())?.telegram).toBeNull();
  });

  it("si la comunidad ya no existe lo dice", async () => {
    const e = escenario();
    const { token } = await crearTokenVinculo(e.base, new ObjectId(), e.ahora());
    await e.manejar(e.mensaje(`/start ${token}`));
    expect(e.ultimaRespuesta()).toBe(T.comunidadInexistente);
  });

  it("/start sin token muestra la ayuda", async () => {
    const e = escenario();
    await e.manejar(e.mensaje("/start"));
    expect(e.ultimaRespuesta()).toBe(T.ayuda);
  });
});

describe("/estado", () => {
  it("en un chat sin vincular lo explica", async () => {
    const e = escenario();
    await e.manejar(e.mensaje("/estado"));
    expect(e.ultimaRespuesta()).toBe(T.noVinculado);
  });

  it("sin lecturas dice que todavía no hay", async () => {
    const e = escenario();
    e.base.vincularFalso(e.nodo.comunidad_id, 100);
    await e.manejar(e.mensaje("/estado"));
    expect(e.ultimaRespuesta()).toContain("todavía no hay lecturas");
  });

  function conUltimo(e: ReturnType<typeof escenario>, parcial: Partial<UltimoNodo>) {
    e.base.vincularFalso(e.nodo.comunidad_id, 100);
    e.base.ultimos.set(e.nodo._id.toHexString(), {
      ts: new Date(T0 - 4_000),
      v: { ph: 6.2 },
      estado: "fuera_de_rango",
      estados: { ph: "fuera_de_rango" },
      seq: 9,
      sesion: 0,
      estable: true,
      ultimo_cambio: new Date(T0 - 4_000),
      sin_datos: false,
      ...parcial,
    });
  }

  it("muestra la última lectura con estado, valor y antigüedad", async () => {
    const e = escenario();
    conUltimo(e, {});
    await e.manejar(e.mensaje("/estado"));
    const t = e.ultimaRespuesta() ?? "";
    expect(t).toContain("Primaria X");
    expect(t).toContain("«Tinaco azotea»");
    expect(t).toContain("🟠 Fuera de rango");
    expect(t).toContain("pH 6.20");
    expect(t).toContain("lectura hace 4 s");
  });

  it("un nodo detenido aparece como «Sin conexión»", async () => {
    const e = escenario();
    conUltimo(e, { sin_datos: true, ts: new Date(T0 - 600_000) });
    await e.manejar(e.mensaje("/estado"));
    expect(e.ultimaRespuesta()).toContain("⚪ Sin conexión");
    expect(e.ultimaRespuesta()).toContain("hace 10 minutos");
  });
});

describe("/reporte", () => {
  const PDF = new Uint8Array([37, 80, 68, 70, 45]);
  const generarOk: Generar = async (nodo) => ({
    nombreArchivo: `reporte-${nodo.nombre.toLowerCase().replace(/\s+/g, "-")}.pdf`,
    pdf: PDF,
  });

  it("en un chat sin vincular lo explica", async () => {
    const e = escenario({ generar: generarOk });
    await e.manejar(e.mensaje("/reporte"));
    expect(e.ultimaRespuesta()).toBe(T.noVinculado);
    expect(e.documentos).toHaveLength(0);
  });

  it("manda el PDF del nodo con una leyenda honesta, y avisa que lo está preparando", async () => {
    const llamadas: number[] = [];
    const e = escenario({
      generar: async (nodo, dias) => {
        llamadas.push(dias);
        return generarOk(nodo, dias);
      },
    });
    e.base.vincularFalso(e.nodo.comunidad_id, 100);
    await e.manejar(e.mensaje("/reporte"));
    expect(llamadas).toEqual([7]); // el valor por defecto sale del catálogo
    expect(e.enviados.map((x) => x.texto)).toEqual([T.reporteEnCurso(7)]);
    expect(e.documentos).toEqual([
      {
        chat: 100,
        nombre: "reporte-tinaco-azotea.pdf",
        bytes: 5,
        leyenda: T.reporteLeyenda("Tinaco azotea", 7),
      },
    ]);
    expect(e.documentos[0]?.leyenda).toContain("no certifica el agua");
  });

  it("acepta un número de días y también /reporte@bot", async () => {
    const llamadas: number[] = [];
    const e = escenario({
      generar: async (nodo, dias) => {
        llamadas.push(dias);
        return generarOk(nodo, dias);
      },
    });
    e.base.vincularFalso(e.nodo.comunidad_id, 100);
    await e.manejar(e.mensaje("/reporte 30"));
    await e.manejar(e.mensaje("/reporte@lympha26_bot 1"));
    await e.manejar(e.mensaje("/reporte@otro_bot 3"));
    expect(llamadas).toEqual([30, 1]); // el comando dirigido a otro bot se ignora
    expect(e.documentos).toHaveLength(2);
  });

  it("rechaza días fuera de 1 a 90 o que no son un número, sin generar nada", async () => {
    const llamadas: number[] = [];
    const e = escenario({
      generar: async (nodo, dias) => {
        llamadas.push(dias);
        return generarOk(nodo, dias);
      },
    });
    e.base.vincularFalso(e.nodo.comunidad_id, 100);
    for (const malo of ["0", "91", "-3", "abc", "7.5", "1000"]) {
      await e.manejar(e.mensaje(`/reporte ${malo}`));
      expect(e.ultimaRespuesta(), malo).toBe(T.reporteDiasInvalidos);
    }
    expect(llamadas).toEqual([]);
    expect(e.documentos).toHaveLength(0);
  });

  it("manda un PDF por cada nodo de la comunidad", async () => {
    const e = escenario({ generar: generarOk });
    e.base.vincularFalso(e.nodo.comunidad_id, 100);
    e.base.agregarNodo(nodoDePrueba(e.nodo.comunidad_id, "Cisterna"));
    await e.manejar(e.mensaje("/reporte"));
    expect(e.documentos.map((d) => d.nombre).sort()).toEqual([
      "reporte-cisterna.pdf",
      "reporte-tinaco-azotea.pdf",
    ]);
  });

  it("una comunidad sin nodos lo dice", async () => {
    const e = escenario({ generar: generarOk });
    const vacia = new ObjectId();
    e.base.comunidades.set(vacia.toHexString(), { _id: vacia, nombre: "Vacía", telegram: null });
    e.base.vincularFalso(vacia, 100);
    await e.manejar(e.mensaje("/reporte"));
    expect(e.ultimaRespuesta()).toBe(T.reporteSinNodos);
  });

  it("si se pide otro mientras se prepara el primero, responde que está ocupado", async () => {
    let liberar: () => void = () => {};
    const espera = new Promise<void>((r) => {
      liberar = r;
    });
    const e = escenario({
      generar: async (nodo, dias) => {
        await espera;
        return generarOk(nodo, dias);
      },
    });
    e.base.vincularFalso(e.nodo.comunidad_id, 100);
    const primero = e.manejar(e.mensaje("/reporte"));
    await vi.waitFor(() => expect(e.enviados).toHaveLength(1)); // ya mandó «Preparando…»
    await e.manejar(e.mensaje("/reporte"));
    expect(e.ultimaRespuesta()).toBe(T.reporteOcupado);
    liberar();
    await primero;
    expect(e.documentos).toHaveLength(1);
    // Ya libre, se puede pedir otro.
    await e.manejar(e.mensaje("/reporte"));
    expect(e.documentos).toHaveLength(2);
  });

  it("si falla la generación responde con un error amable y libera el chat", async () => {
    let falla = true;
    const e = escenario({
      generar: async (nodo, dias) => {
        if (falla) throw new Error("boom: detalle interno");
        return generarOk(nodo, dias);
      },
    });
    e.base.vincularFalso(e.nodo.comunidad_id, 100);
    await e.manejar(e.mensaje("/reporte"));
    expect(e.ultimaRespuesta()).toBe(T.errorInterno);
    expect(e.ultimaRespuesta()).not.toContain("boom");
    expect(e.logs.error).toHaveLength(1);
    falla = false;
    await e.manejar(e.mensaje("/reporte"));
    expect(e.documentos).toHaveLength(1);
  });

  it("sin generador configurado dice que no está disponible", async () => {
    const e = escenario();
    e.base.vincularFalso(e.nodo.comunidad_id, 100);
    await e.manejar(e.mensaje("/reporte"));
    expect(e.ultimaRespuesta()).toBe(T.reporteNoDisponible);
  });

  it("la ayuda lo menciona", () => {
    expect(T.ayuda).toContain("/reporte [días]");
  });
});

describe("/desvincular", () => {
  it("solo quien vinculó puede desvincular", async () => {
    const e = escenario();
    e.base.vincularFalso(e.nodo.comunidad_id, -900, 77);
    const grupo = { id: -900, type: "group" };
    await e.manejar(e.mensaje("/desvincular", grupo, 5));
    expect(e.ultimaRespuesta()).toBe(T.soloQuienVinculo);
    expect(e.base.comunidades.get(e.nodo.comunidad_id.toHexString())?.telegram).not.toBeNull();

    await e.manejar(e.mensaje("/desvincular", grupo, 77));
    expect(e.ultimaRespuesta()).toBe(T.desvinculado);
    expect(e.base.comunidades.get(e.nodo.comunidad_id.toHexString())?.telegram).toBeNull();
  });

  it("en un chat que no estaba vinculado lo dice", async () => {
    const e = escenario();
    await e.manejar(e.mensaje("/desvincular"));
    expect(e.ultimaRespuesta()).toBe(T.nadaQueDesvincular);
  });

  it("también acepta /stop", async () => {
    const e = escenario();
    e.base.vincularFalso(e.nodo.comunidad_id, 100, 42);
    await e.manejar(e.mensaje("/stop"));
    expect(e.ultimaRespuesta()).toBe(T.desvinculado);
  });
});

describe("ruido y fallos", () => {
  it("ignora comandos dirigidos a otro bot y texto que no es comando", async () => {
    const e = escenario();
    await e.manejar(e.mensaje("/estado@otro_bot", { id: -1, type: "group" }));
    await e.manejar(e.mensaje("hola a todos", { id: -1, type: "group" }));
    await e.manejar({ update_id: 99 });
    expect(e.enviados).toHaveLength(0);
  });

  it("un comando desconocido da la ayuda en privado y silencio en un grupo", async () => {
    const e = escenario();
    await e.manejar(e.mensaje("/hola"));
    expect(e.ultimaRespuesta()).toBe(T.ayuda);
    const antes = e.enviados.length;
    await e.manejar(e.mensaje("/hola", { id: -1, type: "group" }));
    expect(e.enviados).toHaveLength(antes);
  });

  it("/ayuda responde con los comandos", async () => {
    const e = escenario();
    await e.manejar(e.mensaje("/ayuda"));
    expect(e.ultimaRespuesta()).toContain("/estado");
    expect(e.ultimaRespuesta()).toContain("Lympha-HP26");
  });

  it("si la base falla responde un error amable, sin detalles", async () => {
    const e = escenario();
    e.base.caido = true;
    await e.manejar(e.mensaje("/estado"));
    expect(e.ultimaRespuesta()).toBe(T.errorInterno);
    expect(e.ultimaRespuesta()).not.toMatch(/Mongo/i);
  });

  it("si no se puede responder, no lanza (el vínculo ya quedó guardado)", async () => {
    const e = escenario();
    const { token } = await crearTokenVinculo(e.base, e.nodo.comunidad_id, e.ahora());
    e.romperEnvio();
    await expect(e.manejar(e.mensaje(`/start ${token}`))).resolves.toBeUndefined();
    expect(e.base.comunidades.get(e.nodo.comunidad_id.toHexString())?.telegram?.chat_id).toBe(100);
    expect(e.logs.warn.length).toBeGreaterThan(0);
  });

  it("los logs no llevan el token de vinculación", async () => {
    const e = escenario();
    const { token } = await crearTokenVinculo(e.base, e.nodo.comunidad_id, e.ahora());
    await e.manejar(e.mensaje(`/start ${token}`));
    expect(JSON.stringify(e.logs)).not.toContain(token);
  });
});
