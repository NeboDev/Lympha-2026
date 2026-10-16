import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { comandoV1, topico } from "@lympha/contracts";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { iniciarIngest } from "../src/main/ingest.ts";
import { iniciarWorker } from "../src/main/worker.ts";
import { depsDesdeBd, desplegar, registrarVersion } from "../src/modules/ota/index.ts";
import { cargarConfig } from "../src/platform/config.ts";
import { ClienteDynsec } from "../src/platform/dynsec.ts";
import { crearLogger } from "../src/platform/logger.ts";
import {
  cerrarCliente,
  crearClienteMqtt,
  esperarConexion,
  type MqttClient,
} from "../src/platform/mqtt.ts";
import {
  iniciarMosquitto,
  iniciarPostgres,
  iniciarValkey,
  type MosquittoDePrueba,
  MQTT_PW,
  type PostgresDePrueba,
  type ValkeyDePrueba,
} from "./helpers/contenedores.ts";

const ESPACIO = "0192f3a7-0000-7000-8000-00000000a0e1";
const LOTE = "0192f3a7-0000-7000-8000-0000000000f1";
const USUARIO = "0192f3a7-0000-7000-8000-00000000a001";
const NODOS = [1, 2, 3].map((i) => `0192f3a7-0000-7000-8000-00000000d00${i}`);
const PW_NODO = "pw-nodo";
const log = crearLogger("prueba", "silent");

let pgc: PostgresDePrueba;
let vk: ValkeyDePrueba;
let mq: MosquittoDePrueba;
let owner: pg.Client;
let control: MqttClient;
let dirOta: string;

const env = (extra: Record<string, string>) => ({
  APP_ENV: "local",
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  ...extra,
});

/** Un nodo de prueba: recibe `cmd` y responde como lo haría el firmware (o falla a propósito). */
async function nodoSimulado(
  id: string,
  comportamiento: "bien" | "rechaza",
  recibidos: string[],
): Promise<MqttClient> {
  const c = crearClienteMqtt({ url: mq.url, username: id, password: PW_NODO, clientId: id });
  await esperarConexion(c);
  await c.subscribeAsync(topico(id, "cmd"), { qos: 1 });
  c.on("message", async (_t, carga) => {
    const cmd = comandoV1.parse(JSON.parse(carga.toString()));
    recibidos.push(id);
    if (cmd.op !== "ota") return;
    if (comportamiento === "rechaza") {
      await c.publishAsync(
        topico(id, "cmd/ack"),
        JSON.stringify({ v: 1, id: cmd.id, ok: false, detail: "sha256 distinto" }),
        { qos: 1 },
      );
      return;
    }
    await c.publishAsync(
      topico(id, "cmd/ack"),
      JSON.stringify({ v: 1, id: cmd.id, ok: true, detail: "reiniciando" }),
      { qos: 1 },
    );
    // el nodo "reinicia", vuelve con la versión nueva y publica
    await new Promise((r) => setTimeout(r, 1100));
    await c.publishAsync(
      topico(id, "attributes"),
      JSON.stringify({ v: 1, fw: cmd.version, rssi: -60 }),
      { qos: 1 },
    );
    await c.publishAsync(
      topico(id, "telemetry"),
      JSON.stringify({
        v: 1,
        ts: Math.floor(Date.now() / 1000),
        seq: 1,
        ph: 7,
        t: 22,
        ec: 480,
        turb: 0.8,
        tds: 310,
      }),
      { qos: 1 },
    );
  });
  return c;
}

beforeAll(async () => {
  [pgc, vk, mq] = await Promise.all([iniciarPostgres(), iniciarValkey(), iniciarMosquitto()]);
  const { migrar } = await import("../src/platform/migrar.ts");
  await migrar(pgc.url("owner"));
  owner = new pg.Client({ connectionString: pgc.url("owner") });
  await owner.connect();
  await owner.query(
    `INSERT INTO app.usuarios (id, auth_uid, email) VALUES ('${USUARIO}', 'uid-ana', 'ana@example.com');
     INSERT INTO app.espacios (id, nombre, tipo) VALUES ('${ESPACIO}', 'Casa de Ana', 'hogar');
     INSERT INTO app.membresias (espacio_id, usuario_id, rol) VALUES ('${ESPACIO}', '${USUARIO}', 'propietario');
     INSERT INTO app.lotes (id, cantidad, version_hw) VALUES ('${LOTE}', 3, 'v1');`,
  );
  for (const id of NODOS) {
    await owner.query(
      `INSERT INTO app.nodos (id, lote_id, espacio_id, estado, claim_hash, reclamado_en, version_fw)
       VALUES ($1, '${LOTE}', '${ESPACIO}', 'activo', $2, now(), '1.0.0')`,
      [id, Buffer.from([0])],
    );
    await owner.query(
      `INSERT INTO app.estado_nodo (nodo_id, espacio_id, conectado, cambio_conexion_en)
       VALUES ($1, '${ESPACIO}', true, now() - interval '1 hour')`,
      [id],
    );
  }

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
  for (const id of NODOS)
    await dynsec.asegurarNodo({ deviceId: id, password: PW_NODO, loteId: LOTE });
  await cerrarCliente(admin);

  control = crearClienteMqtt({
    url: mq.url,
    username: "lympha-control",
    password: MQTT_PW.control,
    clientId: "lympha-control-ota-prueba",
  });
  await esperarConexion(control);

  dirOta = mkdtempSync(join(tmpdir(), "lympha-ota-it-"));
  writeFileSync(join(dirOta, "origen.bin"), Buffer.from("firmware 1.1.0"));
}, 300_000);

afterAll(async () => {
  if (control) await cerrarCliente(control).catch(() => undefined);
  await owner?.end();
  await Promise.all([pgc?.detener(), vk?.detener(), mq?.detener()]);
  if (dirOta) rmSync(dirOta, { recursive: true, force: true });
});

describe("OTA de punta a punta (broker, ingest, worker y Postgres reales)", () => {
  let ingest: Awaited<ReturnType<typeof iniciarIngest>>;
  let worker: Awaited<ReturnType<typeof iniciarWorker>>;
  const nodos: MqttClient[] = [];

  beforeAll(async () => {
    worker = await iniciarWorker(
      cargarConfig(
        "worker",
        env({ DATABASE_URL_SYSTEM: pgc.url("system"), VALKEY_URL: vk.url("worker") }),
      ),
      log,
    );
    ingest = await iniciarIngest(
      cargarConfig(
        "ingest",
        env({
          DATABASE_URL_SYSTEM: pgc.url("system"),
          VALKEY_URL: vk.url("ingest"),
          MQTT_URL: mq.url,
          MQTT_INGEST_USER: "lympha-ingest",
          MQTT_INGEST_PASSWORD: MQTT_PW.ingest,
        }),
      ),
      log,
    );
    await new Promise((r) => setTimeout(r, 500));
  });
  afterAll(async () => {
    for (const n of nodos) await cerrarCliente(n).catch(() => undefined);
    await ingest?.detener();
    await worker?.detener();
  });

  const opciones = { etapas: [34, 100], sondeoMs: 200, ventanaMs: 30_000 };

  it("una versión publicada no se pisa con otro contenido", async () => {
    const v = await registrarVersion(owner, dirOta, join(dirOta, "origen.bin"), "1.1.0");
    expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
    await registrarVersion(owner, dirOta, join(dirOta, "origen.bin"), "1.1.0");
    writeFileSync(join(dirOta, "otro.bin"), Buffer.from("distinto"));
    await expect(
      registrarVersion(owner, dirOta, join(dirOta, "otro.bin"), "1.1.0"),
    ).rejects.toThrow(/otro contenido/);
  });

  it("falla de un nodo: se detiene en la primera etapa y no toca al resto", async () => {
    const recibidos: string[] = [];
    // el primero en orden de deviceId rechaza la actualización
    nodos.push(await nodoSimulado(NODOS[0] as string, "rechaza", recibidos));
    nodos.push(await nodoSimulado(NODOS[1] as string, "bien", recibidos));
    nodos.push(await nodoSimulado(NODOS[2] as string, "bien", recibidos));

    const fw = (await registrarVersion(owner, dirOta, join(dirOta, "origen.bin"), "1.1.0"))!;
    const r = await desplegar(
      depsDesdeBd(owner, control, fw, "http://192.168.1.50:8080"),
      "1.1.0",
      { ...opciones, etapas: [1, 100] },
    );
    expect(r.estado).toBe("detenido");
    expect(r.etapa).toBe(1);
    expect(r.motivo).toContain("sha256 distinto");
    expect(recibidos).toEqual([NODOS[0]]);

    const estados = await owner.query("SELECT estado FROM app.despliegues_ota");
    expect(estados.rows).toEqual([{ estado: "detenido" }]);
    const cmds = await owner.query("SELECT nodo_id, estado, detalle FROM app.comandos_nodo");
    expect(cmds.rows).toEqual([{ nodo_id: NODOS[0], estado: "error", detalle: "sha256 distinto" }]);
    for (const n of nodos.splice(0)) await cerrarCliente(n);
  }, 60_000);

  it("despliegue sano: 34 % y luego 100 %; los nodos vuelven con la versión nueva", async () => {
    const recibidos: string[] = [];
    for (const id of NODOS) nodos.push(await nodoSimulado(id, "bien", recibidos));
    const fw = (await registrarVersion(owner, dirOta, join(dirOta, "origen.bin"), "1.1.0"))!;

    const etapasVistas: string[] = [];
    const deps = depsDesdeBd(owner, control, fw, "http://192.168.1.50:8080", (t) =>
      etapasVistas.push(t),
    );
    const r = await desplegar(deps, "1.1.0", opciones);
    expect(r).toMatchObject({ estado: "completado", etapa: 100, actualizados: 3 });
    expect(etapasVistas).toHaveLength(2);
    // cada nodo recibió el comando una sola vez
    expect([...recibidos].sort()).toEqual([...NODOS].sort());

    const v = await owner.query("SELECT version_fw FROM app.nodos WHERE id = ANY($1::uuid[])", [
      NODOS,
    ]);
    expect(v.rows.map((f) => f.version_fw)).toEqual(["1.1.0", "1.1.0", "1.1.0"]);
    const c = await owner.query(
      "SELECT estado, count(*) n FROM app.comandos_nodo WHERE despliegue_id = (SELECT id FROM app.despliegues_ota WHERE estado = 'completado') GROUP BY estado",
    );
    expect(c.rows).toEqual([{ estado: "ok", n: "3" }]);
  }, 90_000);

  it("sin nodos con otra versión no hay despliegue", async () => {
    const fw = (await registrarVersion(owner, dirOta, join(dirOta, "origen.bin"), "1.1.0"))!;
    await expect(
      desplegar(depsDesdeBd(owner, control, fw, "http://192.168.1.50:8080"), "1.1.0", opciones),
    ).rejects.toThrow(/no hay nodos/);
  });

  it("el worker no puede escribir comandos de otro estado (solo responder)", async () => {
    const sistema = new pg.Client({ connectionString: pgc.url("system") });
    await sistema.connect();
    try {
      await expect(
        sistema.query("INSERT INTO app.comandos_nodo (id, nodo_id, op) VALUES ('x', $1, 'ota')", [
          NODOS[0],
        ]),
      ).rejects.toThrow(/permission denied/);
      await expect(sistema.query("UPDATE app.comandos_nodo SET op = 'reboot'")).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await sistema.end();
    }
  });
});
