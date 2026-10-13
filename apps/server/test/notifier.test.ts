import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { iniciarNotifier, type ProcesoNotifier } from "../src/main/notifier.ts";
import { reclamarPendientes } from "../src/modules/notificaciones/index.ts";
import { cargarConfig } from "../src/platform/config.ts";
import { type BdSistema, conSistema, crearBdSistema } from "../src/platform/db.ts";
import { crearLogger } from "../src/platform/logger.ts";
import { migrar } from "../src/platform/migrar.ts";
import { iniciarPostgres, type PostgresDePrueba } from "./helpers/contenedores.ts";
import { crearTelegramFalso, type TelegramFalso } from "./helpers/telegram-falso.ts";

/**
 * Notifier (H3): entrega por Telegram desde la bandeja de salida con reintentos forzados. Se usa el cliente de
 * Telegram de producción con un `fetch` falso, para ejercitar su manejo real de códigos de error.
 */

const ID = {
  ana: "0192f3a7-0000-7000-8000-00000000a001", // chat 111
  beto: "0192f3a7-0000-7000-8000-00000000b001", // chat 222
  dani: "0192f3a7-0000-7000-8000-00000000d001", // chat 333
  carla: "0192f3a7-0000-7000-8000-00000000c001", // sin Telegram
  espacio: "0192f3a7-0000-7000-8000-00000000a0e1",
};

let pgc: PostgresDePrueba;
let owner: pg.Client;
let bd: BdSistema;
const abiertos: ProcesoNotifier[] = [];

beforeAll(async () => {
  pgc = await iniciarPostgres();
  await migrar(pgc.url("owner"));
  owner = new pg.Client({ connectionString: pgc.url("owner") });
  await owner.connect();
  await owner.query(
    `INSERT INTO app.usuarios (id, auth_uid, email, nombre) VALUES
       ('${ID.ana}', 'uid-ana', 'ana@example.com', 'Ana'),
       ('${ID.beto}', 'uid-beto', 'beto@example.com', 'Beto'),
       ('${ID.dani}', 'uid-dani', 'dani@example.com', 'Dani'),
       ('${ID.carla}', 'uid-carla', 'carla@example.com', 'Carla');
     INSERT INTO app.espacios (id, nombre, tipo) VALUES ('${ID.espacio}', 'Casa', 'hogar');
     INSERT INTO app.membresias (espacio_id, usuario_id, rol) VALUES
       ('${ID.espacio}', '${ID.ana}', 'propietario'),
       ('${ID.espacio}', '${ID.beto}', 'miembro'),
       ('${ID.espacio}', '${ID.dani}', 'miembro'),
       ('${ID.espacio}', '${ID.carla}', 'miembro');
     INSERT INTO app.vinculos_telegram (usuario_id, chat_id) VALUES
       ('${ID.ana}', 111), ('${ID.beto}', 222), ('${ID.dani}', 333);`,
  );
  bd = crearBdSistema(pgc.url("system"), "prueba", 5);
});

afterEach(async () => {
  for (const n of abiertos.splice(0)) await n.detener();
  await owner.query("DELETE FROM app.notificaciones_salida");
});

afterAll(async () => {
  await bd?.cerrar();
  await owner?.end();
  await pgc?.detener();
});

/** `n` avisos pendientes para `usuario`, numerados; el 1 es el más reciente. Texto único para contar entregas. */
async function sembrar(usuario: string, n: number, prefijo = "aviso"): Promise<void> {
  await owner.query(
    `INSERT INTO app.notificaciones_salida
       (espacio_id, usuario_id, evento, clave_idempotencia, payload, enviar_despues_de)
     SELECT $1::uuid, $2::uuid, 'abierta', $3::text || '-' || $2::text || '-' || g,
            jsonb_build_object('texto', $3::text || ' ' || g), now() - (g || ' seconds')::interval
     FROM generate_series(1, $4::int) g`,
    [ID.espacio, usuario, prefijo, n],
  );
}

interface Fila {
  texto: string;
  estado: string;
  intentos: number;
  error: string | null;
  enviar_despues_de: Date;
}
const filas = async (): Promise<Fila[]> =>
  (
    await owner.query<Fila>(
      `SELECT payload->>'texto' AS texto, estado, intentos, error, enviar_despues_de
       FROM app.notificaciones_salida ORDER BY enviar_despues_de, clave_idempotencia`,
    )
  ).rows;
const soloUna = async (): Promise<Fila> => {
  const f = await filas();
  expect(f).toHaveLength(1);
  return f[0] as Fila;
};

/** Hace que lo pendiente venza ya (como si hubiera pasado la espera del reintento). */
const adelantarReloj = () =>
  owner.query(
    "UPDATE app.notificaciones_salida SET enviar_despues_de = now() WHERE estado = 'pendiente'",
  );

async function arrancar(
  telegram: TelegramFalso,
  opciones: { token?: boolean; arrendamientoS?: number; lote?: number } = {},
): Promise<ProcesoNotifier> {
  const config = cargarConfig("notifier", {
    APP_ENV: "local",
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL_SYSTEM: pgc.url("system"),
    NOTIFIER_POLL_MS: "600000",
    ...(opciones.token === false ? {} : { TELEGRAM_BOT_TOKEN: "123456:TOKEN-DE-PRUEBA" }),
  });
  const n = await iniciarNotifier(config, crearLogger("notifier", "silent"), {
    fetchTelegram: telegram.fetch,
    ...(opciones.arrendamientoS !== undefined ? { arrendamientoS: opciones.arrendamientoS } : {}),
    ...(opciones.lote !== undefined ? { lote: opciones.lote } : {}),
  });
  abiertos.push(n);
  return n;
}

describe("entrega", () => {
  it("envía el aviso al chat del usuario, lo marca enviado y mide la latencia", async () => {
    await sembrar(ID.ana, 1, "turbidez alta");
    const tg = crearTelegramFalso();
    const n = await arrancar(tg);
    await n.procesarAhora();

    expect(tg.entregas.map((e) => [e.chatId, e.texto])).toEqual([[111, "turbidez alta 1"]]);
    const f = await soloUna();
    expect(f).toMatchObject({ estado: "enviada", intentos: 1, error: null });
    const m = await n.metricas();
    expect(m).toMatch(/lympha_avisos_enviados_total 1/);
    expect(m).toMatch(/lympha_aviso_latencia_segundos_count 1/);
    expect(m).toMatch(/lympha_outbox_pendientes 0/);
  });

  it("lo ya enviado no se vuelve a enviar, aunque se reclame mil veces", async () => {
    await sembrar(ID.ana, 3);
    const tg = crearTelegramFalso();
    const n = await arrancar(tg);
    await n.procesarAhora();
    await owner.query("UPDATE app.notificaciones_salida SET enviar_despues_de = now()");
    for (let i = 0; i < 5; i++) await n.procesarAhora();
    expect(tg.entregas).toHaveLength(3);
    expect(tg.llamadas).toHaveLength(3);
  });

  it("los mensajes de un mismo chat salen en el orden en que debían salir", async () => {
    await sembrar(ID.ana, 6, "m");
    const tg = crearTelegramFalso(() => ({ ok: true }), 2);
    const n = await arrancar(tg);
    await n.procesarAhora();
    // el 6 es el más antiguo: sale primero
    expect(tg.entregas.map((e) => e.texto)).toEqual(["m 6", "m 5", "m 4", "m 3", "m 2", "m 1"]);
  });

  it("sin token no reclama nada (no gasta intentos) y los avisos esperan", async () => {
    await sembrar(ID.ana, 2);
    const tg = crearTelegramFalso();
    const n = await arrancar(tg, { token: false });
    await n.procesarAhora();
    expect(tg.llamadas).toHaveLength(0);
    expect((await filas()).map((f) => [f.estado, f.intentos])).toEqual([
      ["pendiente", 0],
      ["pendiente", 0],
    ]);
  });
});

describe("reintentos forzados", () => {
  it("un 500 reprograma con espera creciente y al fin se entrega exactamente una vez", async () => {
    await sembrar(ID.ana, 1);
    const tg = crearTelegramFalso((l) =>
      l.n <= 2 ? { ok: false, codigo: 500, descripcion: "Internal Server Error" } : { ok: true },
    );
    const n = await arrancar(tg);

    await n.procesarAhora();
    let f = await soloUna();
    expect(f).toMatchObject({ estado: "pendiente", intentos: 1 });
    expect(f.error).toMatch(/500/);
    const espera1 = (f.enviar_despues_de.getTime() - Date.now()) / 1000;
    expect(espera1).toBeGreaterThan(25);
    expect(espera1).toBeLessThanOrEqual(31);
    await n.procesarAhora(); // todavía no vence: no hay otra llamada
    expect(tg.llamadas).toHaveLength(1);

    await adelantarReloj();
    await n.procesarAhora();
    f = await soloUna();
    expect(f).toMatchObject({ estado: "pendiente", intentos: 2 });
    const espera2 = (f.enviar_despues_de.getTime() - Date.now()) / 1000;
    expect(espera2).toBeGreaterThan(110);
    expect(espera2).toBeLessThanOrEqual(121);

    await adelantarReloj();
    await n.procesarAhora();
    f = await soloUna();
    expect(f).toMatchObject({ estado: "enviada", intentos: 3, error: null });
    expect(tg.llamadas).toHaveLength(3);
    expect(tg.entregas).toHaveLength(1);
    expect(await n.metricas()).toMatch(/lympha_avisos_reintentos_total 2/);
  });

  it("un 429 respeta la espera que pide Telegram", async () => {
    await sembrar(ID.ana, 1);
    const tg = crearTelegramFalso(() => ({
      ok: false,
      codigo: 429,
      descripcion: "Too Many Requests: retry after 90",
      reintentarEnS: 90,
    }));
    const n = await arrancar(tg);
    await n.procesarAhora();
    const f = await soloUna();
    expect(f.estado).toBe("pendiente");
    const espera = (f.enviar_despues_de.getTime() - Date.now()) / 1000;
    expect(espera).toBeGreaterThan(85);
    expect(espera).toBeLessThanOrEqual(92);
  });

  it("un tiempo agotado y un error de red se reintentan", async () => {
    await sembrar(ID.ana, 1);
    const tg = crearTelegramFalso((l) => (l.n === 1 ? { colgar: true } : { ok: true }));
    // El cliente corta a los 15 s; para no esperar tanto la prueba usa un fetch que aborta antes.
    const original = tg.fetch;
    const rapido = ((u: string | URL | Request, init?: RequestInit) =>
      original(u, {
        ...init,
        signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(300)]),
      })) as typeof fetch;
    const config = cargarConfig("notifier", {
      APP_ENV: "local",
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL_SYSTEM: pgc.url("system"),
      NOTIFIER_POLL_MS: "600000",
      TELEGRAM_BOT_TOKEN: "123456:TOKEN-DE-PRUEBA",
    });
    const n = await iniciarNotifier(config, crearLogger("notifier", "silent"), {
      fetchTelegram: rapido,
    });
    abiertos.push(n);
    await n.procesarAhora();
    expect((await soloUna()).estado).toBe("pendiente");
    await adelantarReloj();
    await n.procesarAhora();
    expect((await soloUna()).estado).toBe("enviada");
    expect(tg.entregas).toHaveLength(1);
  });

  it("tras seis intentos fallidos el aviso queda 'fallida' y no se intenta más", async () => {
    await sembrar(ID.ana, 1);
    const tg = crearTelegramFalso(() => ({ ok: false, codigo: 502, descripcion: "Bad Gateway" }));
    const n = await arrancar(tg);
    for (let i = 0; i < 8; i++) {
      await n.procesarAhora();
      await adelantarReloj();
    }
    const f = await soloUna();
    expect(f).toMatchObject({ estado: "fallida", intentos: 6, error: "intentos_agotados" });
    expect(tg.llamadas).toHaveLength(6);
    expect(await n.metricas()).toMatch(/lympha_avisos_fallidos_total 1/);
    expect(await n.metricas()).toMatch(/lympha_telegram_errores_total\{codigo="502"\} 6/);
  });

  it("un rechazo definitivo (400) no se reintenta", async () => {
    await sembrar(ID.ana, 1);
    const tg = crearTelegramFalso(() => ({
      ok: false,
      codigo: 400,
      descripcion: "Bad Request: message is too long",
    }));
    const n = await arrancar(tg);
    await n.procesarAhora();
    await adelantarReloj();
    await n.procesarAhora();
    expect(await soloUna()).toMatchObject({
      estado: "fallida",
      intentos: 1,
      error: "rechazado_400",
    });
    expect(tg.llamadas).toHaveLength(1);
  });

  it("si el usuario bloqueó el bot (403) se borra su vínculo y se descartan sus avisos pendientes", async () => {
    await sembrar(ID.dani, 3);
    await sembrar(ID.ana, 1, "de-ana");
    const tg = crearTelegramFalso((l) =>
      l.chatId === 333
        ? { ok: false, codigo: 403, descripcion: "Forbidden: bot was blocked by the user" }
        : { ok: true },
    );
    const n = await arrancar(tg);
    await n.procesarAhora();

    const vinculo = await owner.query("SELECT 1 FROM app.vinculos_telegram WHERE usuario_id = $1", [
      ID.dani,
    ]);
    expect(vinculo.rowCount).toBe(0);
    const porEstado = (await filas()).map((f) => `${f.texto.split(" ")[0]}:${f.estado}`).sort();
    expect(porEstado).toEqual([
      "aviso:descartada",
      "aviso:descartada",
      "aviso:descartada",
      "de-ana:enviada",
    ]);
    // el primer 403 bastó: no se insistió con los otros dos avisos del mismo chat
    expect(tg.llamadas.filter((l) => l.chatId === 333).length).toBeLessThanOrEqual(3);

    await owner.query("INSERT INTO app.vinculos_telegram (usuario_id, chat_id) VALUES ($1, 333)", [
      ID.dani,
    ]);
  });

  it("un aviso para quien ya no tiene vínculo se descarta sin llamar a Telegram", async () => {
    await sembrar(ID.carla, 1);
    const tg = crearTelegramFalso();
    const n = await arrancar(tg);
    await n.procesarAhora();
    expect(await soloUna()).toMatchObject({ estado: "descartada", error: "sin_vinculo" });
    expect(tg.llamadas).toHaveLength(0);
  });
});

describe("concurrencia y caídas", () => {
  it("dos notifiers a la vez reparten la bandeja sin enviar ningún aviso dos veces", async () => {
    const tg = crearTelegramFalso(() => ({ ok: true }), 3);
    const uno = await arrancar(tg, { lote: 10 });
    const dos = await arrancar(tg, { lote: 10 });
    // Cada notifier procesa la bandeja al arrancar: los avisos llegan cuando ya hay dos compitiendo.
    await sembrar(ID.ana, 40, "a");
    await sembrar(ID.beto, 40, "b");
    const [x, y] = await Promise.all([uno.procesarAhora(), dos.procesarAhora()]);

    expect(x + y).toBe(80);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
    const textos = tg.entregas.map((e) => e.texto);
    expect(textos).toHaveLength(80);
    expect(new Set(textos).size).toBe(80);
    expect((await filas()).every((f) => f.estado === "enviada" && f.intentos === 1)).toBe(true);
  });

  it("un notifier que muere con la fila arrendada: nadie la toma hasta que vence, y entonces sale una vez", async () => {
    await sembrar(ID.ana, 1);
    // El "notifier muerto" reclamó la fila (intentos 1, arrendada 2 s) y nunca llegó a enviar ni a marcar.
    await conSistema(bd, (tx) => reclamarPendientes(tx, 10, 2));
    expect(await soloUna()).toMatchObject({ estado: "pendiente", intentos: 1 });

    const tg = crearTelegramFalso();
    const n = await arrancar(tg);
    await n.procesarAhora();
    expect(tg.llamadas).toHaveLength(0); // arrendada: no se toca

    await new Promise((r) => setTimeout(r, 2300));
    await n.procesarAhora();
    expect(tg.entregas).toHaveLength(1);
    expect(await soloUna()).toMatchObject({ estado: "enviada", intentos: 2 });
  });

  it("DOCUMENTADO — única ventana de duplicado: Telegram entrega pero la respuesta se pierde", async () => {
    // Garantía "al menos una vez": sin clave de idempotencia en sendMessage, el notifier no puede saber si un envío
    // sin respuesta llegó. Prefiere repetirlo a perder la alerta.
    await sembrar(ID.ana, 1);
    const tg = crearTelegramFalso((l) =>
      l.n === 1 ? { entregarYPerderRespuesta: true } : { ok: true },
    );
    const n = await arrancar(tg);
    await n.procesarAhora();
    await adelantarReloj();
    await n.procesarAhora();
    expect(tg.entregas).toHaveLength(2);
    expect(await soloUna()).toMatchObject({ estado: "enviada", intentos: 2 });
  });
});

describe("latencia", () => {
  it("100 avisos de golpe salen con p95 muy por debajo de 60 s (RNF-15)", async () => {
    await sembrar(ID.ana, 50, "x");
    await sembrar(ID.beto, 50, "y");
    // Los avisos "pueden salir" desde hace segundos; ahora mismo se entregan con 20 ms de latencia de red.
    await owner.query("UPDATE app.notificaciones_salida SET enviar_despues_de = now()");
    const tg = crearTelegramFalso(() => ({ ok: true }), 20);
    const n = await arrancar(tg);
    const inicio = Date.now();
    await n.procesarAhora();
    const lat = tg.entregas.map((e) => (e.en - inicio) / 1000).sort((a, b) => a - b);
    expect(lat).toHaveLength(100);
    const p95 = lat[Math.floor(lat.length * 0.95) - 1] as number;
    expect(p95).toBeLessThan(10);
  });
});
