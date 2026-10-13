import { canalEspacio, type EventoAlarma } from "@lympha/contracts";
import type { Nivel } from "@lympha/wqi";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HISTORIAS, type Historia } from "../../../tools/simulator/src/historias.ts";
import { iniciarNodo, type NodoSimulado } from "../../../tools/simulator/src/nodo.ts";
import { iniciarIngest } from "../src/main/ingest.ts";
import { iniciarNotifier, type ProcesoNotifier } from "../src/main/notifier.ts";
import { iniciarWorker } from "../src/main/worker.ts";
import { decidirNivel } from "../src/modules/alarmas/index.ts";
import { reclamarPendientes } from "../src/modules/notificaciones/index.ts";
import { cargarConfig } from "../src/platform/config.ts";
import { conSistema, crearBdSistema } from "../src/platform/db.ts";
import { ClienteDynsec } from "../src/platform/dynsec.ts";
import { crearLogger } from "../src/platform/logger.ts";
import { migrar } from "../src/platform/migrar.ts";
import { cerrarCliente, crearClienteMqtt, esperarConexion } from "../src/platform/mqtt.ts";
import { crearValkey } from "../src/platform/valkey.ts";
import {
  iniciarMosquitto,
  iniciarPostgres,
  iniciarValkey,
  type MosquittoDePrueba,
  MQTT_PW,
  type PostgresDePrueba,
  type ValkeyDePrueba,
} from "./helpers/contenedores.ts";
import { crearTelegramFalso, type TelegramFalso } from "./helpers/telegram-falso.ts";

/**
 * Criterio de salida de H3, de punta a punta con MQTT, ingest, cola, worker, Postgres, notifier y un Telegram falso:
 *   - el aviso llega en menos de 60 s (p95) desde que se confirma el cambio de nivel;
 *   - cero duplicados con reintentos forzados (errores 500/429 de Telegram, notifier reiniciado y notifier muerto);
 *   - un nodo que se cae sin despedirse dispara la alarma de desconexión, y al volver se cierra.
 */

const uuid = (n: number) => `0192f3a7-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const ID = {
  ana: uuid(0xa001),
  beto: uuid(0xb001),
  espacio: uuid(0xa0e1),
  lote: uuid(0xf1),
  nodoA: (i: number) => uuid(0xe000 + i),
  nodoB: (i: number) => uuid(0xe100 + i),
  nodoCaido: uuid(0xe200),
};
const CHAT = { ana: 111, beto: 222 };
const PW_NODO = "pw-nodo";
const log = crearLogger("prueba", "silent");
/** Historias de la segunda tanda (reintentos forzados): las que más alarmas y avisos generan. */
const TANDA_B = [
  "turbidez_sube",
  "ph_alcalino_salto",
  "ph_acido_gradual",
  "sales_altas",
  "recuperacion",
  "sensor_congelado",
];

let pgc: PostgresDePrueba;
let vk: ValkeyDePrueba;
let mq: MosquittoDePrueba;
let owner: pg.Client;

const env = (extra: Record<string, string>) => ({
  APP_ENV: "local",
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  ...extra,
});
const cfgIngest = () =>
  cargarConfig(
    "ingest",
    env({
      DATABASE_URL_SYSTEM: pgc.url("system"),
      VALKEY_URL: vk.url("ingest"),
      MQTT_URL: mq.url,
      MQTT_INGEST_USER: "lympha-ingest",
      MQTT_INGEST_PASSWORD: MQTT_PW.ingest,
    }),
  );
const cfgWorker = (extra: Record<string, string> = {}) =>
  cargarConfig(
    "worker",
    env({
      DATABASE_URL_SYSTEM: pgc.url("system"),
      VALKEY_URL: vk.url("worker"),
      BARRIDO_MS: "500",
      ...extra,
    }),
  );
const cfgNotifier = () =>
  cargarConfig(
    "notifier",
    env({
      DATABASE_URL_SYSTEM: pgc.url("system"),
      NOTIFIER_POLL_MS: "500",
      TELEGRAM_BOT_TOKEN: "123456:TOKEN-DE-PRUEBA",
    }),
  );

async function esperar<T>(f: () => Promise<T | false | null | undefined>, ms = 30_000): Promise<T> {
  const limite = Date.now() + ms;
  let ultimo: unknown;
  while (Date.now() < limite) {
    try {
      const r = await f();
      if (r) return r;
    } catch (e) {
      ultimo = e;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`tiempo agotado esperando la condición${ultimo ? `: ${String(ultimo)}` : ""}`);
}

/** Reproduce una historia por MQTT con 10 s virtuales entre lecturas (todas quedan dentro de los últimos 30 min). */
async function correrHistoria(e: Historia, nodoId: string): Promise<void> {
  const inicio = Date.now() - (e.lecturas + 5) * 10_000;
  let n = 0;
  const nodo = await iniciarNodo({
    deviceId: nodoId,
    password: PW_NODO,
    url: mq.url,
    intervaloS: 0.03,
    historia: e,
    ahora: () => inicio + n++ * 10_000,
  });
  await nodo.terminado;
  await nodo.detener();
}

const evaluaciones = async (nodo: string) =>
  Number(
    (await owner.query("SELECT count(*) AS n FROM ts.evaluaciones WHERE nodo_id = $1", [nodo]))
      .rows[0].n,
  );

interface FilaSalida {
  usuario: "ana" | "beto";
  evento: string;
  tipo: string;
  nodo_id: string;
  estado: string;
  intentos: number;
  texto: string;
  latencia_s: number | null;
}
const salida = async (nodos: string[]): Promise<FilaSalida[]> =>
  (
    await owner.query(
      `SELECT CASE usuario_id WHEN $2 THEN 'ana' ELSE 'beto' END AS usuario, evento, payload->>'tipo' AS tipo,
              payload->>'nodo_id' AS nodo_id, estado, intentos, payload->>'texto' AS texto,
              extract(epoch FROM (enviada_en - creado_en))::float8 AS latencia_s
       FROM app.notificaciones_salida
       WHERE payload->>'nodo_id' = ANY($1::text[])
       ORDER BY payload->>'nodo_id', split_part(clave_idempotencia, ':', 4)::bigint, usuario_id`,
      [nodos, ID.ana],
    )
  ).rows as FilaSalida[];

/**
 * Qué avisos de alarma de nivel debe recibir un usuario según las reglas del producto (RF-27, RF-28, RF-30) para una
 * secuencia de niveles confirmados: se abre al pasar de buena, se avisa cuando cambia a un nivel que quiere, cada
 * mejora que toque sus niveles, y el cierre solo si ya se le avisó de algo.
 */
function avisosEsperados(
  transiciones: Nivel[],
  quiere: readonly ("regular" | "mala" | "critica")[],
): string[] {
  let abierta: "regular" | "mala" | "critica" | null = null;
  let avisado = false;
  const salida: string[] = [];
  for (const nivel of transiciones) {
    const a = decidirNivel(abierta, nivel);
    if (a.tipo === "abrir" || a.tipo === "escalar") {
      abierta = a.severidad;
      if (quiere.includes(a.severidad)) {
        salida.push(a.tipo === "abrir" ? "abierta" : "escalada");
        avisado = true;
      }
    } else if (a.tipo === "mejorar") {
      abierta = a.severidad;
      if (quiere.includes(a.severidad) || quiere.includes(a.anterior)) {
        salida.push("mejorada");
        avisado = true;
      }
    } else if (a.tipo === "resolver") {
      if (avisado) salida.push("resuelta");
      abierta = null;
      avisado = false;
    }
  }
  return salida;
}

const percentil = (valores: number[], p: number): number => {
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.ceil(orden.length * p) - 1)] as number;
};

beforeAll(async () => {
  [pgc, vk, mq] = await Promise.all([iniciarPostgres(), iniciarValkey(), iniciarMosquitto()]);
  await migrar(pgc.url("owner"));
  owner = new pg.Client({ connectionString: pgc.url("owner") });
  await owner.connect();

  const idsB = TANDA_B.map((_, i) => ID.nodoB(i));
  const nodos = [...HISTORIAS.map((_, i) => ID.nodoA(i)), ...idsB, ID.nodoCaido];
  await owner.query(
    `INSERT INTO app.usuarios (id, auth_uid, email) VALUES
       ('${ID.ana}', 'uid-ana', 'ana@example.com'), ('${ID.beto}', 'uid-beto', 'beto@example.com');
     INSERT INTO app.espacios (id, nombre, tipo) VALUES ('${ID.espacio}', 'Casa', 'hogar');
     INSERT INTO app.membresias (espacio_id, usuario_id, rol) VALUES
       ('${ID.espacio}', '${ID.ana}', 'propietario'), ('${ID.espacio}', '${ID.beto}', 'miembro');
     INSERT INTO app.vinculos_telegram (usuario_id, chat_id) VALUES
       ('${ID.ana}', ${CHAT.ana}), ('${ID.beto}', ${CHAT.beto});
     INSERT INTO app.preferencias_notificacion (usuario_id, nodo_id, niveles) VALUES ('${ID.beto}', NULL, '{critica}');
     INSERT INTO app.lotes (id, cantidad, version_hw) VALUES ('${ID.lote}', ${nodos.length}, 'v1');
     ${nodos
       .map(
         (
           n,
         ) => `INSERT INTO app.nodos (id, lote_id, espacio_id, estado, claim_hash, reclamado_en, nombre)
           VALUES ('${n}', '${ID.lote}', '${ID.espacio}', 'reclamado', '\\x00', now(),
                   ${n === ID.nodoCaido ? "'Tinaco'" : "NULL"});
         INSERT INTO app.estado_nodo (nodo_id, espacio_id) VALUES ('${n}', '${ID.espacio}');`,
       )
       .join("\n")}`,
  );

  const admin = crearClienteMqtt({
    url: mq.url,
    username: "lympha-admin",
    password: MQTT_PW.admin,
    clientId: "lympha-admin-alarmas",
  });
  await esperarConexion(admin);
  const dynsec = new ClienteDynsec(admin);
  await dynsec.aplicarBase([
    {
      username: "lympha-ingest",
      password: MQTT_PW.ingest,
      rolename: "ingest",
      clientid: "lympha-ingest",
    },
    { username: "lympha-control", password: MQTT_PW.control, rolename: "control" },
  ]);
  for (const n of nodos) {
    await dynsec.asegurarNodo({ deviceId: n, password: PW_NODO, loteId: ID.lote });
  }
  await cerrarCliente(admin);
}, 300_000);

afterAll(async () => {
  await owner?.end();
  await Promise.all([pgc?.detener(), vk?.detener(), mq?.detener()]);
});

describe("aviso en menos de 60 s (p95) y cero duplicados", () => {
  let ingest: Awaited<ReturnType<typeof iniciarIngest>>;
  let worker: Awaited<ReturnType<typeof iniciarWorker>>;
  let notifier: ProcesoNotifier;
  let telegram: TelegramFalso;

  beforeAll(async () => {
    telegram = crearTelegramFalso(() => ({ ok: true }), 20);
    worker = await iniciarWorker(cfgWorker(), log);
    ingest = await iniciarIngest(cfgIngest(), log);
    notifier = await iniciarNotifier(cfgNotifier(), log, { fetchTelegram: telegram.fetch });
    await new Promise((r) => setTimeout(r, 500)); // suscripción de ingest
  });
  afterAll(async () => {
    await notifier?.detener();
    await ingest?.detener();
    await worker?.detener();
  });

  it("las 12 historias del simulador producen las alarmas y los avisos esperados, entregados con p95 < 60 s", async () => {
    await Promise.all(HISTORIAS.map((e, i) => correrHistoria(e, ID.nodoA(i))));
    for (const [i, e] of HISTORIAS.entries()) {
      await esperar(async () => (await evaluaciones(ID.nodoA(i))) === e.lecturas, 90_000);
    }
    const nodos = HISTORIAS.map((_, i) => ID.nodoA(i));
    // todo lo que se escribió en la bandeja sale
    await esperar(async () => {
      const filas = await salida(nodos);
      return filas.length > 0 && filas.every((f) => f.estado === "enviada");
    }, 60_000);
    const filas = await salida(nodos);

    for (const [i, e] of HISTORIAS.entries()) {
      const deNivel = filas.filter((f) => f.nodo_id === ID.nodoA(i) && f.tipo === "nivel");
      for (const [usuario, quiere] of [
        ["ana", ["mala", "critica"]],
        ["beto", ["critica"]],
      ] as const) {
        expect(
          deNivel.filter((f) => f.usuario === usuario).map((f) => f.evento),
          `${e.nombre}: avisos de ${usuario}`,
        ).toEqual(avisosEsperados(e.esperado.transiciones, quiere));
      }

      // un sensor que hay que revisar abre su alarma (RF-39); uno dudoso, no
      const sensor = (
        await owner.query("SELECT estado FROM app.alarmas WHERE nodo_id = $1 AND tipo = 'sensor'", [
          ID.nodoA(i),
        ])
      ).rows;
      expect(
        sensor.map((r) => r.estado),
        `${e.nombre}: alarma de sensor`,
      ).toEqual(e.esperado.confianzaFinal === "revisar" ? ["activa"] : []);
    }

    // la alarma única por nodo y tipo (RF-30): nunca dos abiertas del mismo tipo
    const repetidas = await owner.query(
      "SELECT nodo_id, tipo FROM app.alarmas WHERE estado <> 'resuelta' GROUP BY 1, 2 HAVING count(*) > 1",
    );
    expect(repetidas.rowCount).toBe(0);

    // cada fila de la bandeja se entregó exactamente una vez, sin reintentos
    expect(filas.length).toBeGreaterThan(10);
    expect(filas.every((f) => f.intentos === 1)).toBe(true);
    const entregados = new Map<string, number>();
    for (const x of telegram.entregas) {
      const k = `${x.chatId}|${x.texto}`;
      entregados.set(k, (entregados.get(k) ?? 0) + 1);
    }
    const esperados = new Map<string, number>();
    for (const f of filas) {
      const k = `${f.usuario === "ana" ? CHAT.ana : CHAT.beto}|${f.texto}`;
      esperados.set(k, (esperados.get(k) ?? 0) + 1);
    }
    expect(entregados).toEqual(esperados);

    // RNF-15: del cambio de nivel confirmado al mensaje, p95 de 60 s o menos
    const latencias = filas.map((f) => f.latencia_s as number);
    const p95 = percentil(latencias, 0.95);
    console.info(
      `H3 latencia aviso: n=${latencias.length} p50=${percentil(latencias, 0.5).toFixed(2)}s p95=${p95.toFixed(2)}s máx=${Math.max(...latencias).toFixed(2)}s`,
    );
    expect(p95).toBeLessThan(60);

    // los textos usan nodo, espacio, causa y acción, y nunca prometen que el agua sea potable o segura (RNF-32)
    const critica = filas.find((f) => f.evento === "escalada" && f.texto.includes("crítica"));
    expect(critica?.texto).toMatch(/Nodo e00\d · Casa/);
    expect(critica?.texto).toMatch(/Causa: /);
    for (const f of filas) expect(f.texto).not.toMatch(/potable|\bseguro\b|\bsegura\b/i);
  }, 240_000);
});

describe("reintentos forzados: cero duplicados", () => {
  let ingest: Awaited<ReturnType<typeof iniciarIngest>>;
  let worker: Awaited<ReturnType<typeof iniciarWorker>>;
  let actual: ProcesoNotifier | null = null;
  let telegram: TelegramFalso;

  beforeAll(async () => {
    // Cada aviso falla la primera vez (500); en el segundo intento algunos reciben 429 y al tercero todos pasan.
    const intentos = new Map<string, number>();
    telegram = crearTelegramFalso((l) => {
      const k = `${l.chatId}|${l.texto}`;
      const n = (intentos.get(k) ?? 0) + 1;
      intentos.set(k, n);
      if (n === 1) return { ok: false, codigo: 500, descripcion: "Internal Server Error" };
      if (n === 2 && l.n % 3 === 0) {
        return { ok: false, codigo: 429, descripcion: "Too Many Requests", reintentarEnS: 1 };
      }
      return { ok: true };
    }, 5);
    worker = await iniciarWorker(cfgWorker(), log);
    ingest = await iniciarIngest(cfgIngest(), log);
    await new Promise((r) => setTimeout(r, 500));
  });
  afterAll(async () => {
    await actual?.detener();
    await ingest?.detener();
    await worker?.detener();
  });

  const arrancar = async () => {
    actual = await iniciarNotifier(cfgNotifier(), log, { fetchTelegram: telegram.fetch });
    return actual;
  };
  /** Como si hubieran pasado las esperas de los reintentos (30 s, 2 min…): solo las filas reprogramadas a largo plazo. */
  const adelantarReloj = () =>
    owner.query(
      "UPDATE app.notificaciones_salida SET enviar_despues_de = now() WHERE estado = 'pendiente' AND enviar_despues_de > now() + interval '10 seconds'",
    );

  it("errores 500 y 429 de Telegram, el notifier reiniciado y un notifier muerto con filas arrendadas no duplican ni pierden avisos", async () => {
    await arrancar();
    const historias = TANDA_B.map(
      (nombre) => HISTORIAS.find((h) => h.nombre === nombre) as Historia,
    );
    const nodos = historias.map((_, i) => ID.nodoB(i));
    await Promise.all(historias.map((e, i) => correrHistoria(e, nodos[i] as string)));

    // Mientras se generan los avisos: reintentos, un reinicio normal y un notifier que muere con 3 filas arrendadas.
    let ciclo = 0;
    const bd = crearBdSistema(pgc.url("system"), "prueba-muerte", 2);
    try {
      await esperar(async () => {
        ciclo++;
        await actual?.procesarAhora();
        await adelantarReloj();
        if (ciclo === 8) {
          await actual?.detener(); // reinicio ordenado
          await arrancar();
        }
        if (ciclo === 14) {
          await conSistema(bd, (tx) => reclamarPendientes(tx, 3, 2)); // un notifier "muere" con 3 filas
        }
        // (un solo cliente de pg: las consultas van una tras otra)
        for (const [i, e] of historias.entries()) {
          if ((await evaluaciones(nodos[i] as string)) !== e.lecturas) return false;
        }
        const filas = await salida(nodos);
        return filas.length > 0 && filas.every((f) => f.estado === "enviada");
      }, 120_000);
    } finally {
      await bd.cerrar();
    }

    const filas = await salida(nodos);
    expect(filas.length).toBeGreaterThan(8);
    expect(filas.every((f) => f.estado === "enviada")).toBe(true);
    // todo falló al menos una vez y se entregó después
    expect(filas.every((f) => f.intentos >= 2)).toBe(true);
    expect(telegram.llamadas.length).toBeGreaterThan(telegram.entregas.length);

    // exactamente una entrega por fila: ni una repetida ni una perdida
    const entregados = new Map<string, number>();
    for (const x of telegram.entregas) {
      const k = `${x.chatId}|${x.texto}`;
      entregados.set(k, (entregados.get(k) ?? 0) + 1);
    }
    const esperados = new Map<string, number>();
    for (const f of filas) {
      const k = `${f.usuario === "ana" ? CHAT.ana : CHAT.beto}|${f.texto}`;
      esperados.set(k, (esperados.get(k) ?? 0) + 1);
    }
    expect(entregados).toEqual(esperados);

    // y las alarmas tampoco se duplicaron por los reintentos del lote
    const repetidas = await owner.query(
      "SELECT 1 FROM app.alarmas WHERE nodo_id = ANY($1::uuid[]) AND estado <> 'resuelta' GROUP BY nodo_id, tipo HAVING count(*) > 1",
      [nodos],
    );
    expect(repetidas.rowCount).toBe(0);
  }, 240_000);
});

describe("un nodo que se cae sin despedirse", () => {
  let ingest: Awaited<ReturnType<typeof iniciarIngest>>;
  let worker: Awaited<ReturnType<typeof iniciarWorker>>;
  let notifier: ProcesoNotifier;
  let telegram: TelegramFalso;
  let suscriptor: ReturnType<typeof crearValkey>;
  const cambios: EventoAlarma[] = [];

  beforeAll(async () => {
    // Los nodos de las historias se despidieron (offline limpio): para esta prueba se dan por conectados.
    await owner.query("UPDATE app.estado_nodo SET conectado = true WHERE nodo_id <> $1", [
      ID.nodoCaido,
    ]);
    telegram = crearTelegramFalso(() => ({ ok: true }), 5);
    // Desconexión sostenida de 2 s (en producción son 10 min por perfil) y barrido cada 0.5 s.
    worker = await iniciarWorker(cfgWorker({ ALARMA_SIN_CONEXION_S: "2" }), log);
    ingest = await iniciarIngest(cfgIngest(), log);
    notifier = await iniciarNotifier(cfgNotifier(), log, { fetchTelegram: telegram.fetch });
    suscriptor = crearValkey(vk.url("api"), "prueba-sse");
    suscriptor.on("message", (_c: string, m: string) => {
      const dato = JSON.parse(m) as Partial<EventoAlarma>;
      // el canal también lleva el estado del nodo (`event: estado`); aquí solo importan las alarmas
      if (dato.alarma_id && dato.nodo_id === ID.nodoCaido) cambios.push(dato as EventoAlarma);
    });
    await suscriptor.subscribe(canalEspacio(ID.espacio));
    await new Promise((r) => setTimeout(r, 500));
  });
  afterAll(async () => {
    suscriptor?.disconnect();
    await notifier?.detener();
    await ingest?.detener();
    await worker?.detener();
  });

  const conectado = async () =>
    (await owner.query("SELECT conectado FROM app.estado_nodo WHERE nodo_id = $1", [ID.nodoCaido]))
      .rows[0]?.conectado as boolean;
  const alarmas = async () =>
    (
      await owner.query(
        "SELECT estado FROM app.alarmas WHERE nodo_id = $1 AND tipo = 'sin_conexion' ORDER BY abierta_en",
        [ID.nodoCaido],
      )
    ).rows.map((r) => r.estado as string);
  const mensajes = (chat: number) =>
    telegram.entregas
      .filter((e) => e.chatId === chat && e.texto.includes("Tinaco"))
      .map((e) => e.texto);

  it("el Last Will abre la alarma de desconexión, avisa a los miembros y al volver se cierra", async () => {
    let nodo: NodoSimulado = await iniciarNodo({
      deviceId: ID.nodoCaido,
      password: PW_NODO,
      url: mq.url,
      intervaloS: 0.2,
      maxLecturas: 2,
    });
    await nodo.terminado;
    await esperar(async () => (await conectado()) === true);
    expect(await alarmas()).toEqual([]);

    // Se cae sin despedirse: se corta la conexión sin DISCONNECT y el broker publica el Last Will.
    const caida = Date.now();
    await nodo.cliente.endAsync(true);
    await esperar(async () => (await conectado()) === false);
    await esperar(async () => (await alarmas()).includes("activa"), 20_000);
    await esperar(
      async () => mensajes(CHAT.ana).length > 0 && mensajes(CHAT.beto).length > 0,
      20_000,
    );
    console.info(
      `H3 caída sin despedirse → aviso de Telegram en ${((Date.now() - caida) / 1000).toFixed(1)} s (umbral de prueba: 2 s)`,
    );

    // los dos miembros con Telegram, aunque Beto solo quiera niveles críticos: una desconexión avisa a todos
    expect(mensajes(CHAT.ana)[0]).toMatch(/^⚪ Tinaco · Casa\nSin conexión desde hace \d+ min/);
    expect(mensajes(CHAT.beto)).toHaveLength(1);
    expect(mensajes(CHAT.ana)).toHaveLength(1); // un solo aviso mientras siga caído (RF-30)
    await new Promise((r) => setTimeout(r, 1500)); // varios barridos más
    expect(mensajes(CHAT.ana)).toHaveLength(1);
    expect(await alarmas()).toEqual(["activa"]);

    // Vuelve: el evento `online` cierra la alarma y avisa que regresó.
    nodo = await iniciarNodo({
      deviceId: ID.nodoCaido,
      password: PW_NODO,
      url: mq.url,
      intervaloS: 0.2,
      maxLecturas: 2,
    });
    await esperar(async () => (await alarmas()).join() === "resuelta", 20_000);
    await esperar(
      async () => mensajes(CHAT.ana).length === 2 && mensajes(CHAT.beto).length === 2,
      20_000,
    );
    expect(mensajes(CHAT.ana)[1]).toBe("🟢 Tinaco · Casa\nEl nodo volvió a conectarse.");
    await nodo.terminado;
    await nodo.detener();

    // el espacio se entera por el stream: alarma abierta y luego resuelta
    await esperar(async () => cambios.length >= 2);
    expect(cambios.map((c) => [c.tipo, c.cambio, c.estado])).toEqual([
      ["sin_conexion", "abierta", "activa"],
      ["sin_conexion", "resuelta", "resuelta"],
    ]);
  }, 120_000);
});
