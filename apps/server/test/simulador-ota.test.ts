import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { iniciarNodo, type NodoSimulado } from "../../../tools/simulator/src/nodo.ts";
import { iniciarIngest } from "../src/main/ingest.ts";
import { iniciarWorker } from "../src/main/worker.ts";
import {
  crearServidorOta,
  depsDesdeBd,
  desplegar,
  registrarVersion,
} from "../src/modules/ota/index.ts";
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
const FLOTA = [1, 2, 3].map((i) => `0192f3a7-0000-7000-8000-00000000d00${i}`);
const NODO_BUFFER = "0192f3a7-0000-7000-8000-00000000e001";
const PW_NODO = "pw-nodo";
const log = crearLogger("prueba", "silent");

let pgc: PostgresDePrueba;
let vk: ValkeyDePrueba;
let mq: MosquittoDePrueba;
let owner: pg.Client;
let control: MqttClient;
let dirOta: string;
let servidorOta: ReturnType<typeof crearServidorOta>;
let baseUrl: string;

const env = (extra: Record<string, string>) => ({
  APP_ENV: "local",
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  ...extra,
});

async function esperar<T>(f: () => Promise<T | false | null | undefined>, ms = 30_000): Promise<T> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    const r = await f().catch(() => false as const);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error("tiempo agotado esperando la condición");
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
     INSERT INTO app.lotes (id, cantidad, version_hw) VALUES ('${LOTE}', 4, 'v1');`,
  );
  for (const id of [...FLOTA, NODO_BUFFER]) {
    await owner.query(
      `INSERT INTO app.nodos (id, lote_id, espacio_id, estado, claim_hash, reclamado_en, version_fw)
       VALUES ($1, '${LOTE}', '${ESPACIO}', 'activo', $2, now(), '1.0.0')`,
      [id, Buffer.from([0])],
    );
    await owner.query(
      `INSERT INTO app.estado_nodo (nodo_id, espacio_id, conectado, cambio_conexion_en)
       VALUES ($1, '${ESPACIO}', false, now() - interval '1 hour')`,
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
  for (const id of [...FLOTA, NODO_BUFFER]) {
    await dynsec.asegurarNodo({ deviceId: id, password: PW_NODO, loteId: LOTE });
  }
  await cerrarCliente(admin);

  control = crearClienteMqtt({
    url: mq.url,
    username: "lympha-control",
    password: MQTT_PW.control,
    clientId: "lympha-control-ota-prueba",
  });
  await esperarConexion(control);

  dirOta = mkdtempSync(join(tmpdir(), "lympha-sim-ota-"));
  servidorOta = crearServidorOta(dirOta);
  await new Promise<void>((r) => servidorOta.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(servidorOta.address() as AddressInfo).port}`;
}, 300_000);

afterAll(async () => {
  if (control) await cerrarCliente(control).catch(() => undefined);
  await new Promise((r) => servidorOta?.close(r));
  await owner?.end();
  await Promise.all([pgc?.detener(), vk?.detener(), mq?.detener()]);
  if (dirOta) rmSync(dirOta, { recursive: true, force: true });
});

describe("simulador: buffer sin conexión y OTA (broker, ingest, worker y Postgres reales)", () => {
  let ingest: Awaited<ReturnType<typeof iniciarIngest>>;
  let worker: Awaited<ReturnType<typeof iniciarWorker>>;
  let activos: NodoSimulado[] = [];

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
    await detenerFlota();
    await ingest?.detener();
    await worker?.detener();
  });

  async function detenerFlota(): Promise<void> {
    await Promise.all(activos.map((n) => n.detener().catch(() => undefined)));
    activos = [];
  }

  /** Levanta la flota (el primer nodo, por orden de deviceId, con el comportamiento dado) y espera a verla en línea. */
  async function levantarFlota(
    firmware: string,
    primero: "exito" | "rechaza" | "rollback",
    extra: { rollbackS?: number } = {},
  ): Promise<void> {
    activos = [];
    for (const [i, id] of FLOTA.entries()) {
      activos.push(
        await iniciarNodo({
          deviceId: id,
          password: PW_NODO,
          url: mq.url,
          intervaloS: 1,
          firmware,
          ota: { comportamiento: i === 0 ? primero : "exito", reinicioS: 1, ...extra },
        }),
      );
    }
    await esperar(async () => {
      const r = await owner.query(
        `SELECT count(*) n FROM app.estado_nodo e JOIN app.nodos n ON n.id = e.nodo_id
          WHERE e.nodo_id = ANY($1::uuid[]) AND e.conectado AND n.version_fw = $2`,
        [FLOTA, firmware],
      );
      return Number(r.rows[0].n) === 3;
    });
  }

  const publicar = async (version: string, contenido: string) => {
    const origen = join(dirOta, `origen-${version}.bin`);
    writeFileSync(origen, Buffer.from(contenido));
    return registrarVersion(owner, dirOta, origen, version);
  };

  it("OTA exitosa: los nodos descargan por HTTP, verifican el hash y vuelven con la versión nueva", async () => {
    await levantarFlota("1.0.0", "exito");
    const fw = await publicar("1.1.0", "firmware 1.1.0");
    const r = await desplegar(depsDesdeBd(owner, control, fw, baseUrl), "1.1.0", {
      etapas: [34, 100],
      sondeoMs: 200,
      ventanaMs: 30_000,
    });
    expect(r).toMatchObject({ estado: "completado", actualizados: 3 });
    expect(activos.map((n) => n.firmware())).toEqual(["1.1.0", "1.1.0", "1.1.0"]);
    const v = await owner.query(
      "SELECT DISTINCT version_fw FROM app.nodos WHERE id = ANY($1::uuid[])",
      [FLOTA],
    );
    expect(v.rows).toEqual([{ version_fw: "1.1.0" }]);
    await detenerFlota();
  }, 120_000);

  it("binario alterado en el servidor: el nodo rechaza por hash y el despliegue se detiene sin tocar al resto", async () => {
    await levantarFlota("1.1.0", "exito");
    const fw = await publicar("1.2.0", "firmware 1.2.0");
    // alguien cambia el archivo servido después de registrarlo
    writeFileSync(join(dirOta, fw.archivo), Buffer.from("otro contenido"));
    const r = await desplegar(depsDesdeBd(owner, control, fw, baseUrl), "1.2.0", {
      etapas: [1, 100],
      sondeoMs: 200,
      ventanaMs: 30_000,
    });
    expect(r.estado).toBe("detenido");
    expect(r.motivo).toContain("sha256 distinto");
    const c = await owner.query(
      "SELECT count(*) n FROM app.comandos_nodo c JOIN app.despliegues_ota d ON d.id = c.despliegue_id WHERE d.version = '1.2.0'",
    );
    expect(Number(c.rows[0].n)).toBe(1);
    expect(activos.map((n) => n.firmware())).toEqual(["1.1.0", "1.1.0", "1.1.0"]);
    await detenerFlota();
  }, 120_000);

  it("rollback: la versión nueva no se conecta, el nodo vuelve con la anterior y el despliegue se detiene", async () => {
    await levantarFlota("1.1.0", "rollback", { rollbackS: 8 });
    const fw = await publicar("1.3.0", "firmware 1.3.0");
    const r = await desplegar(depsDesdeBd(owner, control, fw, baseUrl), "1.3.0", {
      etapas: [1, 100],
      sondeoMs: 200,
      ventanaMs: 3000,
    });
    expect(r.estado).toBe("detenido");
    expect(r.etapa).toBe(1);
    expect(r.motivo).toContain("no volvió con la versión 1.3.0");
    // el nodo revierte solo y vuelve a publicar con la versión anterior
    await esperar(async () => {
      const q = await owner.query("SELECT conectado FROM app.estado_nodo WHERE nodo_id = $1", [
        FLOTA[0],
      ]);
      return q.rows[0].conectado === true;
    });
    expect(activos[0]?.firmware()).toBe("1.1.0");
    const v = await owner.query("SELECT version_fw FROM app.nodos WHERE id = $1", [FLOTA[0]]);
    expect(v.rows[0].version_fw).toBe("1.1.0");
    await detenerFlota();
  }, 120_000);

  it("buffer: una caída sin despedirse no pierde lecturas; llegan en orden y con su ts original", async () => {
    // 3 s normales, 6 s sin conexión (el broker publica el Last Will) y el resto normal; una lectura por segundo
    const nodo = await iniciarNodo({
      deviceId: NODO_BUFFER,
      password: PW_NODO,
      url: mq.url,
      intervaloS: 1,
      maxLecturas: 16,
      vaciadoPorSegundo: 50,
      escenario: {
        nombre: "caida",
        repetir: false,
        pasos: [{ duracionS: 3 }, { duracionS: 6, desconectado: true }],
      },
    });
    activos = [nodo];
    let maxEnBuffer = 0;
    const vigilante = setInterval(() => {
      maxEnBuffer = Math.max(maxEnBuffer, nodo.enBuffer());
    }, 100);
    await nodo.terminado;
    clearInterval(vigilante);

    expect(maxEnBuffer).toBeGreaterThanOrEqual(4);
    expect(nodo.descartadas()).toBe(0);

    await esperar(async () => {
      const r = await owner.query("SELECT count(*) n FROM ts.lecturas WHERE nodo_id = $1", [
        NODO_BUFFER,
      ]);
      return Number(r.rows[0].n) === 16;
    });
    const filas = (
      await owner.query("SELECT seq, ts FROM ts.lecturas WHERE nodo_id = $1 ORDER BY ts", [
        NODO_BUFFER,
      ])
    ).rows as { seq: number; ts: Date }[];
    // sin huecos de seq y cada lectura con la hora en que se tomó, no en la que se recibió
    expect(filas.map((f) => f.seq)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    const marcas = filas.map((f) => f.ts.getTime());
    for (let i = 1; i < marcas.length; i++) {
      const dif = (marcas[i] as number) - (marcas[i - 1] as number);
      expect(dif).toBeGreaterThanOrEqual(0);
      expect(dif).toBeLessThanOrEqual(2000);
    }
    await esperar(async () => {
      const q = await owner.query("SELECT conectado FROM app.estado_nodo WHERE nodo_id = $1", [
        NODO_BUFFER,
      ]);
      return q.rows[0].conectado === true;
    });
  }, 120_000);
});
