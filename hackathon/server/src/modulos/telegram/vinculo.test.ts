import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
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
} from "./index.ts";

const marca: Marca = {
  nombre: "Atl",
  nombre_bot: "Lympha-HP26",
  alarma_local_en_avisos: false,
  dosificacion_automatica: false,
};
const T = textosBot(marca);

function escenario() {
  const base = new BaseFalsa();
  const nodo = base.agregarNodo(nodoDePrueba(new ObjectId(), "Tinaco azotea"), "Primaria X");
  const enviados: { chat: number; texto: string }[] = [];
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
    },
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
