import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { parametroDe } from "../../dominio/catalogo.ts";
import { cargarCatalogo } from "../../plataforma/catalogo.ts";
import { muestra, type NombreEscenario } from "../../simulador/escenarios.ts";
import type { Estado } from "../evaluacion/index.ts";
import { crearDocumentoNodo, type NodoDoc, type UltimoNodo } from "../nodos/index.ts";
import type {
  AlmacenIngesta,
  EventoIngesta,
  LectorNodo,
  MuestraDoc,
  ResultadoInsercion,
  Snapshot,
} from "./index.ts";
import { crearIngesta, crearPoller, esperaTrasFallos, peorEstado } from "./index.ts";

const catalogo = cargarCatalogo();
const normaPh = parametroDe(catalogo, "ph").norma;
if (!normaPh || normaPh.min === null || normaPh.max === null) throw new Error("catálogo sin norma");
const norma = { min: normaPh.min, max: normaPh.max };

const T0 = Date.UTC(2026, 10, 19, 15, 0, 0);
const redondear = (n: number) => Number(n.toFixed(2));

/** Mongo en memoria con el mismo índice único (nodo, sesion, seq) que el real. */
class AlmacenFalso implements AlmacenIngesta {
  nodos: NodoDoc[];
  muestras: MuestraDoc[] = [];
  eventos: EventoIngesta[] = [];
  ultimos = new Map<string, UltimoNodo>();
  caido = false;
  constructor(nodos: NodoDoc[]) {
    this.nodos = nodos;
  }
  private revisar() {
    if (this.caido) throw new Error("Mongo caído");
  }
  async listarNodos() {
    this.revisar();
    return this.nodos.map((n) => ({
      ...n,
      ultimo: this.ultimos.get(n._id.toHexString()) ?? n.ultimo,
    }));
  }
  async cargarVentana(id: ObjectId, desde: Date) {
    this.revisar();
    return this.muestras
      .filter((m) => m.nodo_id.equals(id) && m.ts >= desde)
      .map((m) => ({ ts: m.ts, v: m.v }));
  }
  async insertarMuestra(m: MuestraDoc): Promise<ResultadoInsercion> {
    this.revisar();
    const dup = this.muestras.some(
      (x) => x.nodo_id.equals(m.nodo_id) && x.sesion === m.sesion && x.seq === m.seq,
    );
    if (dup) return "duplicada";
    this.muestras.push(m);
    return "insertada";
  }
  async guardarUltimo(id: ObjectId, u: UltimoNodo) {
    this.revisar();
    this.ultimos.set(id.toHexString(), u);
  }
  async registrarEvento(e: EventoIngesta) {
    this.revisar();
    this.eventos.push(e);
  }
}

function nodoDePrueba(): NodoDoc {
  return crearDocumentoNodo({
    comunidadId: new ObjectId(),
    nombre: "Tinaco de prueba",
    tokenCifrado: "v1:x:y:z",
    host: "blynk.cloud",
    catalogo,
    ahora: new Date(T0),
  });
}

/** Un nodo simulado que escribe en «Blynk» exactamente como `pnpm simulador`. */
function lectorDeEscenario(nombre: NombreEscenario, reloj: () => Date): LectorNodo {
  let seq = 0;
  let ultima: Snapshot = {};
  return {
    async leer() {
      const t = (reloj().getTime() - T0) / 1000;
      const m = muestra(nombre, t, norma);
      if (m.escribe) {
        seq++;
        ultima = {
          v2: redondear(m.ph),
          v7: redondear(m.phCrudo),
          v4: m.estado,
          v5: m.estable ? 1 : 0,
          v6: seq,
        };
      }
      return { ...ultima };
    },
  };
}

function entorno(opciones: { sinDatosS?: number; maxPendientes?: number } = {}) {
  let ahoraMs = T0;
  const reloj = () => new Date(ahoraMs);
  const nodo = nodoDePrueba();
  const almacen = new AlmacenFalso([nodo]);
  const logs = { info: [] as object[], warn: [] as object[], error: [] as object[] };
  const logger = {
    info: (o: object) => void logs.info.push(o),
    warn: (o: object) => void logs.warn.push(o),
    error: (o: object) => void logs.error.push(o),
  };
  const nuevaIngesta = (lector: LectorNodo) =>
    crearIngesta({
      almacen,
      lector,
      catalogo,
      sinDatosS: opciones.sinDatosS ?? 60,
      maxPendientes: opciones.maxPendientes,
      reloj,
      logger,
    });
  return {
    nodo,
    almacen,
    logs,
    reloj,
    nuevaIngesta,
    irA: (t: number) => {
      ahoraMs = T0 + t * 1000;
    },
  };
}

const comprimir = (estados: (Estado | null)[]) =>
  estados.filter((e, i) => i === 0 || e !== estados[i - 1]);

describe("ingesta con el simulador de nodo", () => {
  it("acidificación: guarda cada muestra con su estado y recorre los estados esperados", async () => {
    const e = entorno();
    const ingesta = e.nuevaIngesta(lectorDeEscenario("acidificacion", e.reloj));
    for (let t = 0; t <= 900; t += 5) {
      e.irA(t);
      await ingesta.ciclo(e.nodo);
    }
    expect(e.almacen.muestras).toHaveLength(181);
    expect(comprimir(e.almacen.muestras.map((m) => m.estado))).toEqual([
      "en_rango",
      "atencion",
      "fuera_de_rango",
      "critico",
      "fuera_de_rango",
      "atencion",
      "en_rango",
    ]);
    const ultima = e.almacen.muestras[180] as MuestraDoc;
    expect(ultima.estados).toEqual({ ph: "en_rango" });
    expect(ultima.v.ph).toBeCloseTo(7.2, 1);
    expect(ultima.crudo.ph).toBeDefined();
    expect(e.almacen.ultimos.get(e.nodo._id.toHexString())).toMatchObject({
      estado: "en_rango",
      seq: 181,
      sesion: 0,
      sin_datos: false,
    });
    expect(e.almacen.eventos).toHaveLength(0);
  });

  it("nodo detenido: no inserta nada mientras está quieto, avisa una vez y registra la reconexión", async () => {
    const e = entorno({ sinDatosS: 60 });
    const ingesta = e.nuevaIngesta(lectorDeEscenario("nodo_detenido", e.reloj));
    for (let t = 0; t <= 360; t += 5) {
      e.irA(t);
      await ingesta.ciclo(e.nodo);
    }
    // 73 sondeos, 36 de ellos con el nodo detenido (60 s ≤ t < 240 s).
    expect(e.almacen.muestras).toHaveLength(73 - 36);
    expect(
      e.almacen.muestras.some(
        (m) => m.ts.getTime() >= T0 + 60_000 && m.ts.getTime() < T0 + 240_000,
      ),
    ).toBe(false);
    expect(e.almacen.eventos.map((x) => x.tipo)).toEqual(["sin_datos", "reconexion"]);
    // Última muestra aceptada en t = 55 s; se cruza el umbral (60 s) en t = 120 s.
    expect(e.almacen.eventos[0]?.ts.getTime()).toBe(T0 + 120_000);
    expect(e.almacen.eventos[1]?.ts.getTime()).toBe(T0 + 240_000);
    expect(e.almacen.ultimos.get(e.nodo._id.toHexString())?.sin_datos).toBe(false);
  });

  it("sensor desconectado: la muestra y el nodo quedan en «revisar sensor»", async () => {
    const e = entorno();
    const ingesta = e.nuevaIngesta(lectorDeEscenario("sensor_desconectado", e.reloj));
    for (let t = 0; t <= 300; t += 5) {
      e.irA(t);
      await ingesta.ciclo(e.nodo);
    }
    expect(comprimir(e.almacen.muestras.map((m) => m.estado))).toEqual([
      "en_rango",
      "revisar_sensor",
    ]);
    expect(e.almacen.ultimos.get(e.nodo._id.toHexString())?.estado).toBe("revisar_sensor");
    expect(e.almacen.muestras.at(-1)?.estado_nodo).toBe(3);
  });

  it("pico: queda en atención por cambio rápido sin pasar a fuera de rango", async () => {
    const e = entorno();
    const ingesta = e.nuevaIngesta(lectorDeEscenario("pico", e.reloj));
    for (let t = 0; t <= 600; t += 5) {
      e.irA(t);
      await ingesta.ciclo(e.nodo);
    }
    expect(comprimir(e.almacen.muestras.map((m) => m.estado))).toEqual([
      "en_rango",
      "atencion",
      "en_rango",
    ]);
  });
});

describe("idempotencia y reinicios", () => {
  it("al reiniciar el servidor retoma desde lo guardado y no duplica muestras", async () => {
    const e = entorno();
    const lector = lectorDeEscenario("estable", e.reloj);
    const a = e.nuevaIngesta(lector);
    for (let t = 0; t <= 100; t += 5) {
      e.irA(t);
      await a.ciclo(e.nodo);
    }
    expect(e.almacen.muestras).toHaveLength(21);

    // «Reinicio»: instancia nueva, sin memoria, con el nodo tal como quedó en la base.
    const nodoGuardado = (await e.almacen.listarNodos())[0] as NodoDoc;
    const b = e.nuevaIngesta({ leer: async () => ({ v2: 7.2, v7: 7.2, v4: 0, v5: 1, v6: 21 }) });
    e.irA(102);
    const r = await b.ciclo(nodoGuardado);
    expect(r.tipo).toBe("sin_cambio"); // mismo seq que ya estaba guardado
    expect(e.almacen.muestras).toHaveLength(21);

    const c = e.nuevaIngesta(lector);
    for (let t = 105; t <= 150; t += 5) {
      e.irA(t);
      await c.ciclo(nodoGuardado);
    }
    expect(e.almacen.muestras).toHaveLength(21 + 10);
    const claves = e.almacen.muestras.map((m) => `${m.sesion}:${m.seq}`);
    expect(new Set(claves).size).toBe(claves.length);
    expect(e.logs.warn.filter((w) => "seq" in w)).toHaveLength(0);
  });

  it("si el nodo se reinicia (seq baja) abre una sesión nueva y conserva las dos series", async () => {
    const e = entorno();
    const seqs = [500, 501, 1, 2, 3];
    let i = 0;
    const ingesta = e.nuevaIngesta({
      leer: async () => ({ v2: 7.2, v7: 7.2, v4: 0, v5: 1, v6: seqs[i++] as number }),
    });
    for (let t = 0; t < seqs.length * 5; t += 5) {
      e.irA(t);
      await ingesta.ciclo(e.nodo);
    }
    expect(e.almacen.muestras.map((m) => `${m.sesion}:${m.seq}`)).toEqual([
      "0:500",
      "0:501",
      "1:1",
      "1:2",
      "1:3",
    ]);
  });

  it("una muestra duplicada (otro poller) se omite sin romper nada", async () => {
    const e = entorno();
    const lector: LectorNodo = { leer: async () => ({ v2: 7.2, v7: 7.2, v4: 0, v5: 1, v6: 9 }) };
    const a = e.nuevaIngesta(lector);
    await a.ciclo(e.nodo);
    const otra = e.nuevaIngesta(lector); // sin memoria y con el nodo sin `ultimo`: cree que es nueva
    await otra.ciclo(e.nodo);
    expect(e.almacen.muestras).toHaveLength(1);
    expect(e.logs.warn.some((w) => "seq" in w)).toBe(true);
  });
});

describe("fallos", () => {
  it("si Mongo se cae guarda en memoria y al volver escribe todo en orden", async () => {
    const e = entorno();
    const ingesta = e.nuevaIngesta(lectorDeEscenario("estable", e.reloj));
    for (let t = 0; t < 20; t += 5) {
      e.irA(t);
      await ingesta.ciclo(e.nodo);
    }
    e.almacen.caido = true;
    let pendientes = 0;
    for (let t = 20; t < 50; t += 5) {
      e.irA(t);
      pendientes = (await ingesta.ciclo(e.nodo)).pendientes;
    }
    expect(e.almacen.muestras).toHaveLength(4);
    expect(pendientes).toBeGreaterThan(0);

    e.almacen.caido = false;
    e.irA(50);
    const r = await ingesta.ciclo(e.nodo);
    expect(r.pendientes).toBe(0);
    expect(e.almacen.muestras.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(e.almacen.ultimos.get(e.nodo._id.toHexString())?.seq).toBe(11);
  });

  it("el búfer tiene tope: descarta lo más antiguo y lo registra", async () => {
    const e = entorno({ maxPendientes: 6 });
    const ingesta = e.nuevaIngesta(lectorDeEscenario("estable", e.reloj));
    e.irA(0);
    await ingesta.ciclo(e.nodo);
    e.almacen.caido = true;
    let pendientes = 0;
    for (let t = 5; t <= 100; t += 5) {
      e.irA(t);
      pendientes = (await ingesta.ciclo(e.nodo)).pendientes;
    }
    expect(pendientes).toBeLessThanOrEqual(6);
    expect(e.logs.error.length).toBeGreaterThan(0);
  });

  it("si Blynk falla, el error sube y no se guarda nada ni se inventan lecturas", async () => {
    const e = entorno();
    const ingesta = e.nuevaIngesta({
      leer: async () => {
        throw new Error("Sin respuesta de Blynk");
      },
    });
    await expect(ingesta.ciclo(e.nodo)).rejects.toThrow("Sin respuesta de Blynk");
    expect(e.almacen.muestras).toHaveLength(0);
    expect(e.almacen.ultimos.size).toBe(0);
  });

  it("un seq inválido se descarta y se registra", async () => {
    const e = entorno();
    const ingesta = e.nuevaIngesta({ leer: async () => ({ v2: 7.2, v6: "abc" }) });
    expect((await ingesta.ciclo(e.nodo)).tipo).toBe("invalida");
    expect(e.almacen.muestras).toHaveLength(0);
    expect(e.logs.warn).toHaveLength(1);
  });

  it("seq nuevo pero sin pH: la muestra se guarda como «revisar sensor»", async () => {
    const e = entorno();
    const ingesta = e.nuevaIngesta({ leer: async () => ({ v4: 0, v5: 0, v6: 5 }) });
    const r = await ingesta.ciclo(e.nodo);
    expect(r).toMatchObject({ tipo: "muestra", estado: "revisar_sensor" });
    expect(e.almacen.muestras[0]).toMatchObject({ v: {}, estado: "revisar_sensor" });
  });
});

describe("peorEstado", () => {
  it("elige el más grave y devuelve null si no hay estados", () => {
    expect(peorEstado([])).toBeNull();
    expect(peorEstado(["en_rango", "atencion"])).toBe("atencion");
    expect(peorEstado(["critico", "fuera_de_rango"])).toBe("critico");
    expect(peorEstado(["critico", "revisar_sensor"])).toBe("revisar_sensor");
  });
});

describe("poller", () => {
  it("espera exponencial con tope", () => {
    expect(esperaTrasFallos(1, 5000)).toBe(10_000);
    expect(esperaTrasFallos(2, 5000)).toBe(20_000);
    expect(esperaTrasFallos(3, 5000)).toBe(40_000);
    expect(esperaTrasFallos(4, 5000)).toBe(60_000);
    expect(esperaTrasFallos(50, 5000)).toBe(60_000);
  });

  it("un nodo que falla espera sin frenar a los demás y se recupera", async () => {
    const a = nodoDePrueba();
    const b = nodoDePrueba();
    let reloj = 0;
    let fallosA = 2;
    const ciclo = vi.fn(async (n: NodoDoc) => {
      if (n === a && fallosA > 0) {
        fallosA--;
        throw new Error("Blynk respondió 500");
      }
      return { tipo: "sin_cambio" as const, sinDatos: false, pendientes: 0 };
    });
    const info = vi.fn();
    const poller = crearPoller({
      ingesta: { ciclo },
      almacen: { listarNodos: async () => [a, b] },
      pollMs: 5000,
      ahoraMs: () => reloj,
      logger: { info, warn: vi.fn(), error: vi.fn() },
    });
    const llamadasA = () => ciclo.mock.calls.filter(([n]) => n === a).length;
    const llamadasB = () => ciclo.mock.calls.filter(([n]) => n === b).length;

    await poller.ronda(); // t=0: A falla (espera 10 s), B bien
    expect([llamadasA(), llamadasB()]).toEqual([1, 1]);
    reloj = 5000;
    await poller.ronda(); // A sigue en espera; B sigue sondeándose
    expect([llamadasA(), llamadasB()]).toEqual([1, 2]);
    reloj = 10_000;
    await poller.ronda(); // A reintenta y falla otra vez (espera 20 s)
    expect(llamadasA()).toBe(2);
    reloj = 20_000;
    await poller.ronda(); // todavía en espera
    expect(llamadasA()).toBe(2);
    reloj = 30_000;
    await poller.ronda(); // reintenta y se recupera
    expect(llamadasA()).toBe(3);
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ fallos: 2 }), "nodo recuperado");
  });

  it("si Mongo no deja listar los nodos, la ronda no lanza error", async () => {
    const poller = crearPoller({
      ingesta: { ciclo: vi.fn() },
      almacen: {
        listarNodos: async () => {
          throw new Error("Mongo caído");
        },
      },
      pollMs: 5000,
    });
    await expect(poller.ronda()).resolves.toBeUndefined();
  });

  it("iniciar y detener: el bucle corre y se apaga sin esperar el intervalo", async () => {
    const ciclo = vi.fn(async () => ({
      tipo: "sin_cambio" as const,
      sinDatos: false,
      pendientes: 0,
    }));
    const poller = crearPoller({
      ingesta: { ciclo },
      almacen: { listarNodos: async () => [nodoDePrueba()] },
      pollMs: 60_000,
      dormir: (_ms, senal) => new Promise<void>((r) => senal.addEventListener("abort", () => r())),
    });
    poller.iniciar();
    await vi.waitFor(() => expect(ciclo).toHaveBeenCalledTimes(1));
    await poller.detener();
    expect(ciclo).toHaveBeenCalledTimes(1);
  });
});
