import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { BaseFalsa, loggerDePrueba, nodoDePrueba, T0 } from "../../test/falsos.ts";
import { crearEnviador, esperaReintentoMs } from "./index.ts";
import type { AvisoDoc } from "./puertos.ts";

class TelegramFalso {
  enviados: { chat: number; texto: string }[] = [];
  /** Errores que se lanzarán, uno por intento, antes de empezar a tener éxito. */
  errores: unknown[] = [];
  async enviarMensaje(chat: number, texto: string) {
    const e = this.errores.shift();
    if (e) throw e;
    this.enviados.push({ chat, texto });
  }
}

const errorTelegram = (codigo: number | undefined, descripcion: string, reintentarEnS?: number) =>
  Object.assign(new Error(`Telegram sendMessage: ${descripcion}`), {
    codigo,
    descripcion,
    reintentarEnS,
  });

function escenario(opciones: { vinculado?: boolean } = {}) {
  const base = new BaseFalsa();
  const nodo = base.agregarNodo(nodoDePrueba());
  if (opciones.vinculado !== false) base.vincularFalso(nodo.comunidad_id, 777);
  const telegram = new TelegramFalso();
  let ahora = T0;
  const { logs, logger } = loggerDePrueba();
  const enviador = crearEnviador({
    almacen: base,
    telegram,
    reloj: () => new Date(ahora),
    logger,
    arriendoMs: 30_000,
  });
  let n = 0;
  const aviso = (texto: string, extra: Partial<AvisoDoc> = {}): AvisoDoc => ({
    _id: new ObjectId(),
    clave: `k${++n}`,
    comunidad_id: nodo.comunidad_id,
    nodo_id: nodo._id,
    alerta_id: null,
    tipo: "abre",
    texto,
    creado: new Date(T0 + n),
    estado: "pendiente",
    intentos: 0,
    proximo_intento: new Date(T0),
    bloqueado_hasta: null,
    enviado: null,
    ultimo_error: null,
    ...extra,
  });
  return {
    base,
    telegram,
    enviador,
    logs,
    aviso,
    avanzar: (ms: number) => {
      ahora += ms;
    },
    ahora: () => ahora,
  };
}

describe("enviador", () => {
  it("manda los avisos pendientes al chat de la comunidad, en orden, y los marca enviados", async () => {
    const e = escenario();
    await e.base.encolarAviso(e.aviso("primero"));
    await e.base.encolarAviso(e.aviso("segundo"));
    const r = await e.enviador.ronda();
    expect(r).toEqual({ enviados: 2, reprogramados: 0, fallidos: 0 });
    expect(e.telegram.enviados).toEqual([
      { chat: 777, texto: "primero" },
      { chat: 777, texto: "segundo" },
    ]);
    expect(e.base.avisos.every((a) => a.estado === "enviado" && a.intentos === 1)).toBe(true);
  });

  it("no reenvía lo ya enviado", async () => {
    const e = escenario();
    await e.base.encolarAviso(e.aviso("uno"));
    await e.enviador.ronda();
    const r = await e.enviador.ronda();
    expect(r.enviados).toBe(0);
    expect(e.telegram.enviados).toHaveLength(1);
  });

  it("encolar dos veces la misma clave no duplica el aviso", async () => {
    const e = escenario();
    const a = e.aviso("uno", { clave: "alerta1:abre" });
    expect(await e.base.encolarAviso(a)).toBe("encolado");
    expect(await e.base.encolarAviso({ ...a, _id: new ObjectId() })).toBe("duplicado");
    await e.enviador.ronda();
    expect(e.telegram.enviados).toHaveLength(1);
  });

  it("si la comunidad no tiene chat, el aviso se descarta con motivo", async () => {
    const e = escenario({ vinculado: false });
    await e.base.encolarAviso(e.aviso("hola"));
    const r = await e.enviador.ronda();
    expect(r.fallidos).toBe(1);
    expect(e.base.avisos[0]).toMatchObject({ estado: "fallido" });
    expect(e.base.avisos[0]?.ultimo_error).toMatch(/chat vinculado/);
    expect(e.telegram.enviados).toHaveLength(0);
  });

  it("un error de red se reprograma con espera y luego se envía", async () => {
    const e = escenario();
    await e.base.encolarAviso(e.aviso("reintenta"));
    e.telegram.errores = [errorTelegram(undefined, "no se pudo conectar")];

    expect((await e.enviador.ronda()).reprogramados).toBe(1);
    const a = e.base.avisos[0] as AvisoDoc;
    expect(a.estado).toBe("pendiente");
    expect(a.intentos).toBe(1);
    expect(a.proximo_intento.getTime()).toBe(e.ahora() + 5_000);

    // Aún no toca: no se manda.
    e.avanzar(4_000);
    expect((await e.enviador.ronda()).enviados).toBe(0);
    // Ya toca.
    e.avanzar(1_000);
    expect((await e.enviador.ronda()).enviados).toBe(1);
    expect(e.telegram.enviados).toEqual([{ chat: 777, texto: "reintenta" }]);
    expect(e.base.avisos[0]?.estado).toBe("enviado");
  });

  it("respeta el retry_after de Telegram (429)", async () => {
    const e = escenario();
    await e.base.encolarAviso(e.aviso("limite"));
    e.telegram.errores = [errorTelegram(429, "Too Many Requests", 7)];
    await e.enviador.ronda();
    expect(e.base.avisos[0]?.proximo_intento.getTime()).toBe(e.ahora() + 8_000);
  });

  it("un chat bloqueado o inexistente (403) es permanente: no se reintenta", async () => {
    const e = escenario();
    await e.base.encolarAviso(e.aviso("x"));
    e.telegram.errores = [errorTelegram(403, "Forbidden: bot was blocked by the user")];
    const r = await e.enviador.ronda();
    expect(r.fallidos).toBe(1);
    expect(e.base.avisos[0]).toMatchObject({ estado: "fallido", intentos: 1 });
    e.avanzar(3_600_000);
    expect((await e.enviador.ronda()).enviados).toBe(0);
  });

  it("«chat not found» (400) también es permanente, pero otros 400 no", async () => {
    const e = escenario();
    await e.base.encolarAviso(e.aviso("a"));
    e.telegram.errores = [errorTelegram(400, "Bad Request: chat not found")];
    expect((await e.enviador.ronda()).fallidos).toBe(1);

    const f = escenario();
    await f.base.encolarAviso(f.aviso("b"));
    f.telegram.errores = [errorTelegram(400, "Bad Request: message is too long")];
    expect((await f.enviador.ronda()).reprogramados).toBe(1);
  });

  it("tras 8 intentos fallidos se da por perdido y queda registrado", async () => {
    const e = escenario();
    await e.base.encolarAviso(e.aviso("nunca", { intentos: 7 }));
    e.telegram.errores = [errorTelegram(500, "Internal Server Error")];
    const r = await e.enviador.ronda();
    expect(r.fallidos).toBe(1);
    expect(e.base.avisos[0]).toMatchObject({ estado: "fallido", intentos: 8 });
    expect(e.logs.error.length).toBeGreaterThan(0);
  });

  it("los errores guardados y logueados no contienen el token", async () => {
    const e = escenario();
    await e.base.encolarAviso(e.aviso("x"));
    e.telegram.errores = [errorTelegram(undefined, "no se pudo conectar")];
    await e.enviador.ronda();
    const todo = JSON.stringify([e.base.avisos, e.logs]);
    expect(todo).not.toMatch(/api\.telegram\.org|bot\d+:/);
  });

  it("arrendamiento: dos enviadores no toman el mismo aviso, y si uno muere el aviso se recupera", async () => {
    const e = escenario();
    await e.base.encolarAviso(e.aviso("uno"));
    const ahora = new Date(e.ahora());
    expect(await e.base.tomarSiguiente(ahora, 30_000)).not.toBeNull();
    // Otro proceso intenta tomarlo mientras el primero lo tiene.
    expect(await e.base.tomarSiguiente(ahora, 30_000)).toBeNull();
    // El primero murió sin marcarlo: vence el arrendamiento y se toma de nuevo (al menos una vez).
    e.avanzar(31_000);
    expect(await e.base.tomarSiguiente(new Date(e.ahora()), 30_000)).not.toBeNull();
  });

  it("no manda más de maxPorRonda avisos por turno", async () => {
    const e = escenario();
    const chico = crearEnviador({
      almacen: e.base,
      telegram: e.telegram,
      reloj: () => new Date(e.ahora()),
      maxPorRonda: 2,
    });
    for (let i = 0; i < 5; i++) await e.base.encolarAviso(e.aviso(`m${i}`));
    expect((await chico.ronda()).enviados).toBe(2);
    expect((await chico.ronda()).enviados).toBe(2);
    expect((await chico.ronda()).enviados).toBe(1);
  });
});

describe("esperaReintentoMs", () => {
  it("5 s, 10 s, 20 s… con tope de 10 min", () => {
    expect(esperaReintentoMs(1)).toBe(5_000);
    expect(esperaReintentoMs(2)).toBe(10_000);
    expect(esperaReintentoMs(3)).toBe(20_000);
    expect(esperaReintentoMs(20)).toBe(600_000);
  });
});
