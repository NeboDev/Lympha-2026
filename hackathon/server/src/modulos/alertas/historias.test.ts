import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { NombreEscenario } from "../../simulador/escenarios.ts";
import {
  BaseFalsa,
  catalogoDePrueba,
  lectorDeEscenario,
  loggerDePrueba,
  nodoDePrueba,
  T0,
} from "../../test/falsos.ts";
import { crearIngesta } from "../ingesta/index.ts";
import { crearEnviador } from "../notificaciones/index.ts";
import { crearManejadorTelegram, crearTokenVinculo } from "../telegram/index.ts";
import { crearAlertas } from "./index.ts";

/**
 * Historias de punta a punta: simulador de nodo → ingesta (con evaluación) → alertas → bandeja →
 * Telegram. Cada historia dice qué mensajes recibe la comunidad. Todo en memoria y con reloj falso.
 */

const marca = {
  nombre: "Atl",
  nombre_bot: "Lympha-HP26",
  alarma_local_en_avisos: false,
  dosificacion_automatica: false,
};

function montar(escenario: NombreEscenario, opciones: { recordatorioMin?: number } = {}) {
  const base = new BaseFalsa();
  const nodo = base.agregarNodo(nodoDePrueba(new ObjectId(), "Tinaco azotea"), "Primaria X");
  let ahora = T0;
  const reloj = () => new Date(ahora);
  const lector = lectorDeEscenario(escenario, reloj);
  const { logs, logger } = loggerDePrueba();

  /** Lo que llegaría al chat de Telegram. `fallos` simula una red caída: cada elemento falla un envío. */
  const chat: string[] = [];
  const control = { fallos: 0 };
  const cliente = {
    async enviarMensaje(_chat: number, texto: string) {
      if (control.fallos > 0) {
        control.fallos--;
        throw Object.assign(new Error("no se pudo conectar"), {
          descripcion: "no se pudo conectar",
        });
      }
      chat.push(texto);
    },
    // Estas historias no piden reportes: solo existe para cumplir la interfaz del bot.
    async enviarDocumento() {},
  };

  // Un «servidor» completo; se puede volver a crear para simular un reinicio.
  function crearServidor() {
    const alertas = crearAlertas({
      almacen: base,
      catalogo: catalogoDePrueba,
      marca,
      recordatorioMin: opciones.recordatorioMin ?? 30,
      reloj,
      logger,
    });
    const ingesta = crearIngesta({
      almacen: base,
      lector,
      catalogo: catalogoDePrueba,
      sinDatosS: 60,
      alCambio: (c) => alertas.sincronizar(c),
      reloj,
      logger,
    });
    const enviador = crearEnviador({ almacen: base, telegram: cliente, reloj, logger });
    return { alertas, ingesta, enviador };
  }
  let servidor = crearServidor();

  return {
    base,
    nodo,
    chat,
    control,
    logs,
    reiniciarServidor: () => {
      servidor = crearServidor();
    },
    /** Vincula el chat como lo haría una persona: con el enlace de un solo uso. */
    async vincular() {
      const manejar = crearManejadorTelegram({
        almacen: base,
        cliente,
        marca,
        catalogo: catalogoDePrueba,
        usuarioBot: "lympha26_bot",
        reloj,
        logger,
      });
      const { token } = await crearTokenVinculo(base, nodo.comunidad_id, reloj());
      await manejar({
        update_id: 1,
        message: {
          text: `/start ${token}`,
          chat: { id: 555, type: "group", title: "Padres" },
          from: { id: 42 },
        },
      });
      chat.length = 0; // la bienvenida no cuenta
    },
    /** Avanza hasta el segundo `hasta`, sondeando cada 5 s, con barrido y envío como el servidor real. */
    async correr(hasta: number, desde = 0) {
      for (let t = desde; t <= hasta; t += 5) {
        ahora = T0 + t * 1000;
        await servidor.ingesta.ciclo((await base.listarNodos())[0] ?? nodo);
        if (t % 15 === 0) await servidor.alertas.barrido();
        await servidor.enviador.ronda();
      }
    },
  };
}

const posicion = (chat: string[], marca: string) => chat.findIndex((t) => t.includes(marca));
const cuantos = (chat: string[], marca: string) => chat.filter((t) => t.includes(marca)).length;

describe("historia: acidificación (limón y luego bicarbonato)", () => {
  it("la comunidad recibe: cambio rápido, fuera de rango, crítico, recordatorios y recuperación", async () => {
    const m = montar("acidificacion", { recordatorioMin: 4 });
    await m.vincular();
    await m.correr(900);

    const chat = m.chat;
    // El orden cuenta la historia.
    const iRapido = posicion(chat, "🔸");
    const iFuera = posicion(chat, "🔶");
    const iCritico = posicion(chat, "🟥");
    const iRecupera = posicion(chat, "volvió al rango");
    expect(iRapido).toBeGreaterThanOrEqual(0);
    expect(iFuera).toBeGreaterThan(iRapido);
    expect(iCritico).toBeGreaterThan(iFuera);
    expect(iRecupera).toBeGreaterThan(iCritico);

    // Un aviso por transición: cada cosa se avisa una sola vez.
    expect(cuantos(chat, "🔶")).toBe(1);
    expect(cuantos(chat, "🟥")).toBe(1);
    expect(cuantos(chat, "volvió al rango")).toBe(1);
    // Mientras sigue mal, hay recordatorios (con recordatorioMin = 4 y la mitad en críticas).
    expect(cuantos(chat, "🔁")).toBeGreaterThanOrEqual(1);
    // Al final todo se cierra y se avisa que se estabilizó.
    expect(chat.at(-1)).toContain("se estabilizó");
    expect(m.base.alertas.every((a) => a.estado === "cerrada")).toBe(true);

    // El aviso de pH alto/bajo: con pH bajo no se habla del cloro.
    expect(chat.join("\n")).not.toContain("cloro");
    // Nunca un duplicado, y nunca «potable» ni «seguro».
    expect(new Set(chat).size).toBe(chat.length);
    expect(chat.join("\n")).not.toMatch(/potable|segur[oa]s?\b/i);
    expect(m.base.avisos.every((a) => a.estado === "enviado")).toBe(true);
    expect(new Set(m.base.avisos.map((a) => a.clave)).size).toBe(m.base.avisos.length);
  });

  it("un reinicio del servidor a media alerta no repite ningún aviso", async () => {
    const m = montar("acidificacion", { recordatorioMin: 4 });
    await m.vincular();
    await m.correr(200);
    const antes = [...m.chat];
    expect(cuantos(antes, "🔶")).toBe(1);

    m.reiniciarServidor();
    await m.correr(900, 205);
    expect(cuantos(m.chat, "🔶")).toBe(1);
    expect(cuantos(m.chat, "🟥")).toBe(1);
    expect(cuantos(m.chat, "volvió al rango")).toBe(1);
    expect(m.chat.slice(0, antes.length)).toEqual(antes);
  });

  it("si Telegram falla un rato, los avisos llegan igual, en orden y sin duplicarse", async () => {
    const m = montar("acidificacion", { recordatorioMin: 4 });
    await m.vincular();
    m.control.fallos = 6; // los primeros seis envíos fallan
    await m.correr(900);
    expect(cuantos(m.chat, "🔶")).toBe(1);
    expect(cuantos(m.chat, "🟥")).toBe(1);
    expect(posicion(m.chat, "🔶")).toBeLessThan(posicion(m.chat, "🟥"));
    expect(m.base.avisos.filter((a) => a.estado === "fallido")).toHaveLength(0);
    expect(m.base.avisos.every((a) => a.estado === "enviado")).toBe(true);
  });
});

describe("historia: nodo detenido", () => {
  it("avisa una sola vez que no llegan datos y avisa cuando vuelve", async () => {
    const m = montar("nodo_detenido");
    await m.vincular();
    await m.correr(360);
    expect(m.chat).toHaveLength(2);
    expect(m.chat[0]).toContain("⚪ No recibimos datos de «Tinaco azotea»");
    expect(m.chat[1]).toContain("✅ «Tinaco azotea» volvió a enviar datos");
    expect(m.base.alertas).toHaveLength(1);
    expect(m.base.alertas[0]?.tipo).toBe("sin_conexion");
  });

  it("si sigue detenido, recuerda cada 30 min y no inventa lecturas", async () => {
    const m = montar("nodo_detenido", { recordatorioMin: 1 });
    await m.vincular();
    await m.correr(230); // el nodo está detenido de 60 s a 240 s
    expect(cuantos(m.chat, "⚪ No recibimos datos")).toBe(1);
    expect(cuantos(m.chat, "🔁")).toBeGreaterThanOrEqual(1);
    expect(m.base.muestras.every((x) => x.ts.getTime() < T0 + 60_000)).toBe(true);
  });
});

describe("historia: sensor desconectado", () => {
  it("avisa que la lectura no es confiable (no que el agua esté mal)", async () => {
    const m = montar("sensor_desconectado");
    await m.vincular();
    await m.correr(300);
    expect(cuantos(m.chat, "❔")).toBe(1);
    expect(m.chat.join("\n")).not.toContain("🔶");
    expect(m.chat.join("\n")).not.toContain("🟥");
    expect(m.chat[0]).toContain("no es confiable");
  });
});

describe("historia: agua estable y comunidad sin Telegram", () => {
  it("estable: no manda ningún mensaje", async () => {
    const m = montar("estable");
    await m.vincular();
    await m.correr(300);
    expect(m.chat).toHaveLength(0);
    expect(m.base.alertas).toHaveLength(0);
    expect(m.base.avisos).toHaveLength(0);
  });

  it("sin chat vinculado: la alerta queda registrada, nada se envía y al vincular llega lo que sigue abierto", async () => {
    const m = montar("sensor_desconectado");
    await m.correr(200);
    expect(m.chat).toHaveLength(0);
    expect(m.base.alertas.filter((a) => a.estado === "abierta")).toHaveLength(1);
    expect(m.base.alertas[0]?.ultimo_aviso).toBeNull();
    expect(m.base.eventos.some((e) => e.tipo === "alerta_abre")).toBe(true);

    await m.vincular();
    await m.correr(260, 205);
    expect(cuantos(m.chat, "❔")).toBe(1);
  });
});
