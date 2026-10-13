import { topico } from "@lympha/contracts";
import { Worker } from "bullmq";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { iniciarNodo } from "../../../tools/simulator/src/nodo.ts";
import { crearApi } from "../src/main/api.ts";
import { iniciarIngest } from "../src/main/ingest.ts";
import { iniciarNotifier } from "../src/main/notifier.ts";
import { iniciarWorker } from "../src/main/worker.ts";
import { crearResolvedorNodo } from "../src/modules/dispositivos/index.ts";
import { cargarConfig } from "../src/platform/config.ts";
import { crearBdSistema } from "../src/platform/db.ts";
import { ClienteDynsec } from "../src/platform/dynsec.ts";
import { crearLogger } from "../src/platform/logger.ts";
import {
  cerrarCliente,
  crearClienteMqtt,
  esperarConexion,
  type MqttClient,
} from "../src/platform/mqtt.ts";
import { COLA_LECTURAS, crearCola } from "../src/platform/queues.ts";
import { crearConexionBullmq, crearValkey } from "../src/platform/valkey.ts";
import {
  iniciarMosquitto,
  iniciarPostgres,
  iniciarValkey,
  type MosquittoDePrueba,
  MQTT_PW,
  type PostgresDePrueba,
  type ValkeyDePrueba,
} from "./helpers/contenedores.ts";
import { tokenDe, verificadorDePrueba } from "./helpers/verificador.ts";

const ID = {
  ana: "0192f3a7-0000-7000-8000-00000000a001",
  beto: "0192f3a7-0000-7000-8000-00000000b001",
  espacioAna: "0192f3a7-0000-7000-8000-00000000a0e1",
  espacioBeto: "0192f3a7-0000-7000-8000-00000000b0e1",
  nodo: "0192f3a7-0000-7000-8000-00000000a0d1",
  nodoLibre: "0192f3a7-0000-7000-8000-00000000c0d1",
  lote: "0192f3a7-0000-7000-8000-0000000000f1",
};
const PW_NODO = "pw-nodo";
const log = crearLogger("prueba", "silent");

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
const cfgWorker = () =>
  cargarConfig(
    "worker",
    env({ DATABASE_URL_SYSTEM: pgc.url("system"), VALKEY_URL: vk.url("worker") }),
  );
const cfgApi = () =>
  cargarConfig(
    "api",
    env({
      DATABASE_URL_APP: pgc.url("app"),
      VALKEY_URL: vk.url("api"),
      MQTT_URL: mq.url,
      MQTT_CONTROL_USER: "lympha-control",
      MQTT_CONTROL_PASSWORD: MQTT_PW.control,
      CLAIM_PEPPER: "pepper",
      FIREBASE_PROJECT_ID: "lympha-test",
    }),
  );

async function esperar<T>(f: () => Promise<T | false | null | undefined>, ms = 20_000): Promise<T> {
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

const contar = async (nodo = ID.nodo) =>
  Number(
    (await owner.query("SELECT count(*) n FROM ts.lecturas WHERE nodo_id = $1", [nodo])).rows[0].n,
  );

const TS0 = Math.floor(Date.now() / 1000) - 3600;
const lectura = (i: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    v: 1,
    ts: TS0 + i * 60,
    seq: i,
    ph: 7 + i / 100,
    t: 22.5,
    ec: 480,
    turb: 0.8,
    tds: 310,
    ...extra,
  });

async function conectarNodo(id: string, password: string): Promise<MqttClient> {
  const c = crearClienteMqtt({ url: mq.url, username: id, password, clientId: id });
  await esperarConexion(c);
  return c;
}

beforeAll(async () => {
  [pgc, vk, mq] = await Promise.all([iniciarPostgres(), iniciarValkey(), iniciarMosquitto()]);

  const { migrar } = await import("../src/platform/migrar.ts");
  await migrar(pgc.url("owner"));
  owner = new pg.Client({ connectionString: pgc.url("owner") });
  await owner.connect();
  await owner.query(
    `INSERT INTO app.usuarios (id, auth_uid, email) VALUES
       ('${ID.ana}', 'uid-ana', 'ana@example.com'), ('${ID.beto}', 'uid-beto', 'beto@example.com');
     INSERT INTO app.espacios (id, nombre, tipo) VALUES
       ('${ID.espacioAna}', 'Casa de Ana', 'hogar'), ('${ID.espacioBeto}', 'Casa de Beto', 'hogar');
     INSERT INTO app.membresias (espacio_id, usuario_id, rol) VALUES
       ('${ID.espacioAna}', '${ID.ana}', 'propietario'), ('${ID.espacioBeto}', '${ID.beto}', 'propietario');
     INSERT INTO app.lotes (id, cantidad, version_hw) VALUES ('${ID.lote}', 2, 'v1');
     INSERT INTO app.nodos (id, lote_id, espacio_id, estado, claim_hash, reclamado_en)
       VALUES ('${ID.nodo}', '${ID.lote}', '${ID.espacioAna}', 'reclamado', '\\x00', now());
     INSERT INTO app.nodos (id, lote_id, estado, claim_hash)
       VALUES ('${ID.nodoLibre}', '${ID.lote}', 'fabricado', '\\x00');
     INSERT INTO app.estado_nodo (nodo_id, espacio_id) VALUES ('${ID.nodo}', '${ID.espacioAna}');`,
  );

  const admin = crearClienteMqtt({
    url: mq.url,
    username: "lympha-admin",
    password: MQTT_PW.admin,
    clientId: "lympha-admin-prueba",
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
  await dynsec.asegurarNodo({ deviceId: ID.nodo, password: PW_NODO, loteId: ID.lote });
  await dynsec.asegurarNodo({ deviceId: ID.nodoLibre, password: PW_NODO, loteId: ID.lote });
  await cerrarCliente(admin);
}, 300_000);

afterAll(async () => {
  await owner?.end();
  await Promise.all([pgc?.detener(), vk?.detener(), mq?.detener()]);
});

describe("de la lectura MQTT a la API", () => {
  let ingest: Awaited<ReturnType<typeof iniciarIngest>>;
  let worker: Awaited<ReturnType<typeof iniciarWorker>>;

  beforeAll(async () => {
    worker = await iniciarWorker(cfgWorker(), log);
    ingest = await iniciarIngest(cfgIngest(), log);
    await new Promise((r) => setTimeout(r, 500)); // suscripción de ingest
  });
  afterAll(async () => {
    await ingest?.detener();
    await worker?.detener();
  });

  it("una lectura publicada por un nodo llega a ts.lecturas y se activa el nodo", async () => {
    const nodo = await conectarNodo(ID.nodo, PW_NODO);
    for (let i = 0; i < 3; i++)
      await nodo.publishAsync(topico(ID.nodo, "telemetry"), lectura(i), { qos: 1 });
    await esperar(async () => (await contar()) === 3);

    const fila = (
      await owner.query("SELECT * FROM ts.lecturas WHERE nodo_id=$1 ORDER BY ts", [ID.nodo])
    ).rows;
    expect(fila.map((f) => f.seq)).toEqual([0, 1, 2]);
    expect(fila[0].espacio_id).toBe(ID.espacioAna);
    expect(fila[0].temperatura).toBeCloseTo(22.5);
    expect(fila[0].conductividad).toBe(480);
    await esperar(async () => {
      const r = await owner.query("SELECT estado FROM app.nodos WHERE id=$1", [ID.nodo]);
      return r.rows[0].estado === "activo";
    });

    // ingest dejó en Valkey la caché del nodo (con TTL): la escribe en una transacción MULTI/EXEC,
    // que la ACL del usuario debe permitir.
    const valkey = crearValkey(vk.url("worker"), "prueba-cache");
    try {
      const meta = await valkey.hgetall(`nodo:${ID.nodo}:meta`);
      expect(meta).toMatchObject({
        espacio_id: ID.espacioAna,
        perfil_id: "cisterna",
        perfil_version: "1",
      });
      const ttl = await valkey.ttl(`nodo:${ID.nodo}:meta`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(600);
    } finally {
      valkey.disconnect();
    }
    await cerrarCliente(nodo);
  });

  it("es idempotente: reenviar la misma lectura (mismo nodo y ts) no duplica", async () => {
    const nodo = await conectarNodo(ID.nodo, PW_NODO);
    await nodo.publishAsync(topico(ID.nodo, "telemetry"), lectura(1), { qos: 1 });
    await nodo.publishAsync(topico(ID.nodo, "telemetry"), lectura(1), { qos: 1 });
    await new Promise((r) => setTimeout(r, 1500));
    expect(await contar()).toBe(3);
    await cerrarCliente(nodo);
  });

  it("descarta payloads inválidos, relojes absurdos y nodos sin espacio sin guardar nada", async () => {
    // El broker confirma al publicador por su cuenta: el rechazo de ingest solo se ve en la base.
    const nodo = await conectarNodo(ID.nodo, PW_NODO);
    const libre = await conectarNodo(ID.nodoLibre, PW_NODO);
    const t = topico(ID.nodo, "telemetry");
    await nodo.publishAsync(t, "no es json", { qos: 1 });
    await nodo.publishAsync(t, lectura(9, { extra: 1 }), { qos: 1 });
    await nodo.publishAsync(t, lectura(9, { ts: 1000 }), { qos: 1 });
    await libre.publishAsync(topico(ID.nodoLibre, "telemetry"), lectura(0), { qos: 1 });
    // una lectura válida al final: cuando aparece, las anteriores ya se procesaron (orden por nodo)
    await nodo.publishAsync(t, lectura(3), { qos: 1 });
    await esperar(async () => (await contar()) === 4);
    expect(await contar(ID.nodoLibre)).toBe(0);
    await cerrarCliente(nodo);
    await cerrarCliente(libre);
  });

  it("un nodo no puede publicar en el tópico de otro nodo (ACL con %u)", async () => {
    const nodo = await conectarNodo(ID.nodo, PW_NODO);
    await expect(
      nodo.publishAsync(topico(ID.nodoLibre, "telemetry"), lectura(5), { qos: 1 }),
    ).rejects.toThrow(/authorized/i);
    await cerrarCliente(nodo);
  });

  it("no pierde lecturas si ingest se reinicia (sesión persistente + PUBACK tras encolar)", async () => {
    await ingest.detener();
    const nodo = await conectarNodo(ID.nodo, PW_NODO);
    for (let i = 10; i < 30; i++)
      await nodo.publishAsync(topico(ID.nodo, "telemetry"), lectura(i), { qos: 1 });
    expect(await contar()).toBe(4); // ingest caído: aún nada
    ingest = await iniciarIngest(cfgIngest(), log);
    await esperar(async () => (await contar()) === 24);
    await cerrarCliente(nodo);
  });

  it("GET /health responde 200 con Postgres, Valkey y MQTT conectados", async () => {
    const api = await crearApi(cfgApi(), log);
    try {
      const r = await esperar(async () => {
        const x = await api.app.inject({ method: "GET", url: "/health" });
        return x.statusCode === 200 ? x : false;
      });
      expect(r.json()).toMatchObject({
        estado: "ok",
        componentes: { postgres: "ok", valkey: "ok", mqtt: "ok" },
      });
    } finally {
      await api.cerrar();
    }
  });

  it("la API devuelve las lecturas por app.v_lecturas y aísla entre usuarios (404)", async () => {
    const api = await crearApi(cfgApi(), log, { verificador: verificadorDePrueba });
    try {
      const url = `/api/nodos/${ID.nodo}/lecturas?limite=5`;
      const ana = await api.app.inject({
        method: "GET",
        url,
        headers: { authorization: tokenDe("uid-ana", "ana@example.com") },
      });
      expect(ana.statusCode).toBe(200);
      const cuerpo = ana.json() as { lecturas: { seq: number; nodo_id: string }[] };
      expect(cuerpo.lecturas).toHaveLength(5);
      expect(cuerpo.lecturas[0]?.seq).toBe(29); // la más reciente primero

      // otro usuario: 404, igual que un nodo que no existe
      const beto = await api.app.inject({
        method: "GET",
        url,
        headers: { authorization: tokenDe("uid-beto", "beto@example.com") },
      });
      expect(beto.statusCode).toBe(404);
      const noExiste = await api.app.inject({
        method: "GET",
        url: "/api/nodos/0192f3a7-0000-7000-8000-0000000000ee/lecturas",
        headers: { authorization: tokenDe("uid-ana", "ana@example.com") },
      });
      expect(noExiste.statusCode).toBe(404);
      expect(beto.json()).toEqual(noExiste.json());
      // sin token no hay respuesta con datos
      const anonimo = await api.app.inject({ method: "GET", url });
      expect(anonimo.statusCode).toBe(401);
      // un nodo sin espacio tampoco se revela
      const libre = await api.app.inject({
        method: "GET",
        url: `/api/nodos/${ID.nodoLibre}/lecturas`,
        headers: { authorization: tokenDe("uid-ana", "ana@example.com") },
      });
      expect(libre.statusCode).toBe(404);
    } finally {
      await api.cerrar();
    }
  });

  it("status (Last Will) y attributes actualizan el estado del nodo y la última lectura", async () => {
    const nodo = crearClienteMqtt({
      url: mq.url,
      username: ID.nodo,
      password: PW_NODO,
      clientId: ID.nodo,
      reconnectPeriod: 0,
      will: {
        topic: topico(ID.nodo, "status"),
        payload: Buffer.from("offline"),
        qos: 1,
        retain: true,
      },
    });
    await esperarConexion(nodo);
    await nodo.publishAsync(topico(ID.nodo, "status"), "online", { qos: 1, retain: true });
    await nodo.publishAsync(
      topico(ID.nodo, "attributes"),
      JSON.stringify({ v: 1, fw: "9.9.9", rssi: -50 }),
      { qos: 1 },
    );
    const estado = async () =>
      (
        await owner.query(
          `SELECT e.conectado, e.ultima_lectura_en, e.ultimos_valores, n.version_fw
           FROM app.estado_nodo e JOIN app.nodos n ON n.id = e.nodo_id WHERE e.nodo_id = $1`,
          [ID.nodo],
        )
      ).rows[0];
    await esperar(async () => {
      const e = await estado();
      return e?.conectado === true && e.version_fw === "9.9.9";
    });
    expect((await estado()).ultima_lectura_en).not.toBeNull();
    expect((await estado()).ultimos_valores).toMatchObject({ ph: expect.any(Number) });

    // Caída sin despedirse: el broker publica el Last Will "offline" (retenido) en nombre del nodo.
    nodo.stream.destroy();
    await esperar(async () => (await estado()).conectado === false);
    await new Promise((r) => setTimeout(r, 300));
    await cerrarCliente(nodo).catch(() => undefined);
  });

  it("expone métricas de ingest (mensajes recibidos por tipo)", async () => {
    const texto = await ingest.metricas();
    expect(texto).toMatch(/lympha_mensajes_recibidos_total\{tipo="telemetry"\} [1-9]/);
    expect(texto).toMatch(/lympha_mensajes_recibidos_total\{tipo="status"\} [1-9]/);
  });
});

describe("resolvedor de nodos con la ACL real de Valkey", () => {
  it("consulta la base, escribe la caché en MULTI/EXEC sin errores y la siguiente vez la lee de Valkey", async () => {
    const bd = crearBdSistema(pgc.url("system"), "prueba-resolver", 2);
    const valkey = crearValkey(vk.url("ingest"), "prueba-resolver");
    try {
      await valkey.del(`nodo:${ID.nodo}:meta`);
      const resolver = crearResolvedorNodo(valkey, bd);

      // Con la ACL sin +@transaction esto lanzaba "EXECABORT ... no permissions to run 'exec'".
      const primera = await resolver.resolver(ID.nodo);
      expect(primera).toMatchObject({ espacioId: ID.espacioAna, perfilId: "cisterna" });

      // La segunda vez no debe tocar Postgres: se cierra el pool y aun así responde.
      await bd.cerrar();
      expect(await resolver.resolver(ID.nodo)).toEqual(primera);

      // Un nodo inexistente se recuerda unos segundos (caché negativa) y se invalida bajo demanda.
      const inexistente = "0192f3a7-0000-7000-8000-0000000000dd";
      const bd2 = crearBdSistema(pgc.url("system"), "prueba-resolver-2", 2);
      try {
        const r2 = crearResolvedorNodo(valkey, bd2);
        expect(await r2.resolver(inexistente)).toBeNull();
        expect(await valkey.ttl(`nodo:${inexistente}:meta`)).toBeGreaterThan(0);
        await r2.invalidar(inexistente);
        expect(await valkey.exists(`nodo:${inexistente}:meta`)).toBe(0);
      } finally {
        await bd2.cerrar();
      }
    } finally {
      valkey.disconnect();
      await bd.cerrar().catch(() => undefined);
    }
  });
});

describe("simulador de nodos", () => {
  const NODO_SIM = "0192f3a7-0000-7000-8000-00000000d0d1";

  it("un nodo simulado publica por MQTT y sus lecturas quedan en ts.lecturas", async () => {
    await owner.query(
      `INSERT INTO app.nodos (id, lote_id, espacio_id, estado, claim_hash, reclamado_en)
       VALUES ($1, $2, $3, 'reclamado', decode('00', 'hex'), now())`,
      [NODO_SIM, ID.lote, ID.espacioAna],
    );
    const admin = crearClienteMqtt({
      url: mq.url,
      username: "lympha-admin",
      password: MQTT_PW.admin,
      clientId: "lympha-admin-prueba-sim",
    });
    await esperarConexion(admin);
    await new ClienteDynsec(admin).asegurarNodo({
      deviceId: NODO_SIM,
      password: PW_NODO,
      loteId: ID.lote,
    });
    await cerrarCliente(admin);

    const worker = await iniciarWorker(cfgWorker(), log);
    const ingest = await iniciarIngest(cfgIngest(), log);
    try {
      const nodo = await iniciarNodo({
        deviceId: NODO_SIM,
        password: PW_NODO,
        url: mq.url,
        intervaloS: 1,
        maxLecturas: 3,
      });
      await nodo.terminado;
      await nodo.detener();
      await esperar(async () => (await contar(NODO_SIM)) === 3);
      const r = await owner.query("SELECT seq, ph FROM ts.lecturas WHERE nodo_id=$1 ORDER BY seq", [
        NODO_SIM,
      ]);
      expect(r.rows.map((f) => f.seq)).toEqual([0, 1, 2]);
      expect(r.rows.every((f) => f.ph > 6 && f.ph < 8.5)).toBe(true);
    } finally {
      await ingest.detener();
      await worker.detener();
    }
  });
});

describe("recuperación del worker", () => {
  it("un lote tomado por un worker que cae se recupera y se guarda sin duplicar", async () => {
    const conexionCola = crearConexionBullmq(vk.url("ingest"), "prueba-cola");
    const cola = crearCola<unknown>(COLA_LECTURAS, conexionCola);
    const ts = (TS0 + 100_000) * 1000;
    await cola.add("lote", {
      lecturas: [
        {
          nodoId: ID.nodo,
          espacioId: ID.espacioAna,
          ts,
          seq: 500,
          ph: 7,
          temperatura: 22,
          conductividad: 400,
          turbidez: 1,
          tds: 250,
          recibidoEn: Date.now(),
        },
      ],
    });

    // Un "worker" toma el trabajo y muere sin completarlo (queda activo con su lock).
    const conexionMuerta = crearConexionBullmq(vk.url("worker"), "prueba-muerto");
    const muerto = new Worker(COLA_LECTURAS, null, {
      connection: conexionMuerta,
      autorun: false,
      lockDuration: 1500,
    });
    const tomado = await muerto.getNextJob("token-muerto", { block: false });
    expect(tomado).toBeDefined();
    conexionMuerta.disconnect();
    expect(await contar()).toBe(24);

    // El worker nuevo detecta el trabajo estancado al vencer el lock y lo procesa.
    const worker = await iniciarWorker(cfgWorker(), log, {
      lockDurationMs: 1500,
      stalledIntervalMs: 500,
    });
    try {
      await esperar(async () => (await contar()) === 25, 30_000);
    } finally {
      await worker.detener();
      await cola.close();
      conexionCola.disconnect();
    }
  });
});

describe("notifier", () => {
  it("arranca, observa la bandeja de salida y se apaga limpio", async () => {
    const n = await iniciarNotifier(
      cargarConfig("notifier", env({ DATABASE_URL_SYSTEM: pgc.url("system") })),
      log,
    );
    await n.detener();
  });
});
