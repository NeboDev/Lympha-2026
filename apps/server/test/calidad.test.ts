import {
  type ConexionNodo,
  type EstadoNodoEvento,
  type EventoConexion,
  eventoConexion,
  topico,
} from "@lympha/contracts";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HISTORIAS, type Historia } from "../../../tools/simulator/src/historias.ts";
import { iniciarNodo } from "../../../tools/simulator/src/nodo.ts";
import { crearApi } from "../src/main/api.ts";
import { iniciarIngest } from "../src/main/ingest.ts";
import { iniciarWorker } from "../src/main/worker.ts";
import { cargarConfig } from "../src/platform/config.ts";
import { ClienteDynsec } from "../src/platform/dynsec.ts";
import { crearLogger } from "../src/platform/logger.ts";
import {
  cerrarCliente,
  crearClienteMqtt,
  esperarConexion,
  type MqttClient,
} from "../src/platform/mqtt.ts";
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
import { tokenDe, verificadorDePrueba } from "./helpers/verificador.ts";

const uuid = (n: number) => `0192f3a7-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const ID = {
  ana: uuid(0xa001),
  beto: uuid(0xb001),
  espacioAna: uuid(0xa0e1),
  espacioBeto: uuid(0xb0e1),
  lote: uuid(0xf1),
  /** Un nodo por escenario, todos en el espacio de Ana. */
  nodoDe: (i: number) => uuid(0xe000 + i),
  nodoSse: uuid(0xc001),
  nodoBeto: uuid(0xc002),
};
const TOKEN = {
  ana: tokenDe("uid-ana", "ana@example.com"),
  beto: tokenDe("uid-beto", "beto@example.com"),
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

interface FilaEvaluacion {
  ts: Date;
  nivel: string;
  confianza: string;
  wqi: string | null;
  parametro_limitante: string | null;
  version_algoritmo: string;
}
const evaluacionesDe = async (nodo: string): Promise<FilaEvaluacion[]> =>
  (
    await owner.query<FilaEvaluacion>(
      "SELECT ts, nivel, confianza, wqi, parametro_limitante, version_algoritmo FROM ts.evaluaciones WHERE nodo_id = $1 ORDER BY ts",
      [nodo],
    )
  ).rows;
const contarEvaluaciones = async (nodo: string) => (await evaluacionesDe(nodo)).length;
const estadoDe = async (nodo: string) =>
  (await owner.query("SELECT * FROM app.estado_nodo WHERE nodo_id = $1", [nodo])).rows[0];

/** Reproduce un escenario del simulador por MQTT con un reloj virtual de un minuto por lectura. */
async function correrHistoria(e: Historia, nodoId: string): Promise<void> {
  const inicio = Date.now() - (e.lecturas + 5) * 60_000;
  let n = 0;
  const nodo = await iniciarNodo({
    deviceId: nodoId,
    password: PW_NODO,
    url: mq.url,
    intervaloS: 0.03,
    historia: e,
    ahora: () => inicio + n++ * 60_000,
  });
  await nodo.terminado;
  await nodo.detener();
}

async function conectarNodo(id: string): Promise<MqttClient> {
  const c = crearClienteMqtt({ url: mq.url, username: id, password: PW_NODO, clientId: id });
  await esperarConexion(c);
  return c;
}

beforeAll(async () => {
  [pgc, vk, mq] = await Promise.all([iniciarPostgres(), iniciarValkey(), iniciarMosquitto()]);

  const { migrar } = await import("../src/platform/migrar.ts");
  await migrar(pgc.url("owner"));
  owner = new pg.Client({ connectionString: pgc.url("owner") });
  await owner.connect();

  const nodos = [
    ...HISTORIAS.map((_, i) => ({ id: ID.nodoDe(i), espacio: ID.espacioAna })),
    { id: ID.nodoSse, espacio: ID.espacioAna },
    { id: ID.nodoBeto, espacio: ID.espacioBeto },
  ];
  await owner.query(
    `INSERT INTO app.usuarios (id, auth_uid, email) VALUES
       ('${ID.ana}', 'uid-ana', 'ana@example.com'), ('${ID.beto}', 'uid-beto', 'beto@example.com');
     INSERT INTO app.espacios (id, nombre, tipo) VALUES
       ('${ID.espacioAna}', 'Casa de Ana', 'hogar'), ('${ID.espacioBeto}', 'Casa de Beto', 'hogar');
     INSERT INTO app.membresias (espacio_id, usuario_id, rol) VALUES
       ('${ID.espacioAna}', '${ID.ana}', 'propietario'), ('${ID.espacioBeto}', '${ID.beto}', 'propietario');
     INSERT INTO app.lotes (id, cantidad, version_hw) VALUES ('${ID.lote}', ${nodos.length}, 'v1');
     ${nodos
       .map(
         (n) => `INSERT INTO app.nodos (id, lote_id, espacio_id, estado, claim_hash, reclamado_en)
           VALUES ('${n.id}', '${ID.lote}', '${n.espacio}', 'reclamado', '\\x00', now());
         INSERT INTO app.estado_nodo (nodo_id, espacio_id) VALUES ('${n.id}', '${n.espacio}');`,
       )
       .join("\n")}`,
  );

  const admin = crearClienteMqtt({
    url: mq.url,
    username: "lympha-admin",
    password: MQTT_PW.admin,
    clientId: "lympha-admin-calidad",
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
    await dynsec.asegurarNodo({ deviceId: n.id, password: PW_NODO, loteId: ID.lote });
  }
  await cerrarCliente(admin);
}, 300_000);

afterAll(async () => {
  await owner?.end();
  await Promise.all([pgc?.detener(), vk?.detener(), mq?.detener()]);
});

describe("de la lectura MQTT al semáforo", () => {
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

  it("cada escenario del simulador produce el nivel esperado sin parpadeo (criterio de salida de H2)", async () => {
    // Todos a la vez: así el worker mezcla nodos en cada lote, como en producción.
    await Promise.all(HISTORIAS.map((e, i) => correrHistoria(e, ID.nodoDe(i))));

    for (const [i, e] of HISTORIAS.entries()) {
      const nodoId = ID.nodoDe(i);
      await esperar(async () => (await contarEvaluaciones(nodoId)) === e.lecturas, 60_000);
      const filas = await evaluacionesDe(nodoId);

      // se omiten las lecturas de arranque, donde aún no hay ventana
      const vistos = filas
        .slice(2)
        .map((f) => f.nivel)
        .filter((n, k, todos) => n !== todos[k - 1]);
      expect(vistos, `${e.nombre}: niveles que vería el usuario`).toEqual(e.esperado.transiciones);

      const final = filas.at(-1);
      expect(final?.confianza, `${e.nombre}: confianza final`).toBe(e.esperado.confianzaFinal);
      expect(final?.version_algoritmo).toBe("0.1-provisional");
      // nunca se informa un WQI junto con "sin_datos"
      for (const f of filas) if (f.nivel === "sin_datos") expect(f.wqi).toBeNull();

      const estado = await estadoDe(nodoId);
      expect(estado.nivel, `${e.nombre}: estado_nodo`).toBe(e.esperado.transiciones.at(-1));
      expect(estado.confianza).toBe(e.esperado.confianzaFinal);
      if (e.esperado.parametroFinal !== undefined) {
        expect(estado.parametro_limitante).toBe(e.esperado.parametroFinal);
      }
      expect(estado.causa.length).toBeGreaterThan(10);
      expect(estado.accion.length).toBeGreaterThan(10);
      expect(estado.ultimos_valores).toHaveProperty("ph");
      expect(estado.espacio_id).toBe(ID.espacioAna);
    }
  }, 180_000);

  it("la frase del estado nombra la causa y la acción, sin decir 'potable' ni 'seguro'", async () => {
    const i = HISTORIAS.findIndex((e) => e.nombre === "turbidez_sube");
    const e = await estadoDe(ID.nodoDe(i));
    expect(e.nivel).toBe("critica");
    expect(e.causa).toMatch(/turbia/);
    expect(e.accion).toMatch(/beber o cocinar/);
    for (const t of [e.causa, e.accion]) expect(t).not.toMatch(/potable|\bseguro\b|\bsegura\b/i);
  });

  it("si Valkey pierde la memoria del nodo, el estado se reconstruye desde Postgres sin parpadear", async () => {
    const i = HISTORIAS.findIndex((e) => e.nombre === "ph_alcalino_salto");
    const nodoId = ID.nodoDe(i);
    expect((await estadoDe(nodoId)).nivel).toBe("critica");
    const antes = await contarEvaluaciones(nodoId);
    const ultimoTs = (await evaluacionesDe(nodoId)).at(-1)?.ts.getTime() as number;

    const valkey = crearValkey(vk.url("worker"), "prueba-vaciar");
    await valkey.del(`nodo:${nodoId}:ventana`, `nodo:${nodoId}:histeresis`);
    valkey.disconnect();

    const nodo = await conectarNodo(nodoId);
    for (let k = 1; k <= 6; k++) {
      await nodo.publishAsync(
        topico(nodoId, "telemetry"),
        JSON.stringify({
          v: 1,
          ts: Math.floor(ultimoTs / 1000) + k * 60,
          seq: 1000 + k,
          ph: 9.3,
          t: 22,
          ec: 450,
          turb: 0.6,
          tds: 290,
        }),
        { qos: 1 },
      );
    }
    await cerrarCliente(nodo);
    await esperar(async () => (await contarEvaluaciones(nodoId)) === antes + 6);
    const nuevas = (await evaluacionesDe(nodoId)).slice(antes);
    expect(nuevas.map((f) => f.nivel)).toEqual(Array(6).fill("critica"));
    expect(nuevas.every((f) => f.confianza === "ok")).toBe(true);
  });

  it("una lectura atrasada se guarda pero no se evalúa ni mueve el estado", async () => {
    const i = HISTORIAS.findIndex((e) => e.nombre === "estable");
    const nodoId = ID.nodoDe(i);
    const antes = await contarEvaluaciones(nodoId);
    const estadoAntes = await estadoDe(nodoId);
    const filas = await evaluacionesDe(nodoId);
    const viejo = Math.floor((filas[0] as FilaEvaluacion).ts.getTime() / 1000) - 3600;

    const nodo = await conectarNodo(nodoId);
    await nodo.publishAsync(
      topico(nodoId, "telemetry"),
      JSON.stringify({ v: 1, ts: viejo, seq: 9999, ph: 3, t: 22, ec: 450, turb: 0.6, tds: 290 }),
      { qos: 1 },
    );
    await cerrarCliente(nodo);
    await esperar(async () => {
      const r = await owner.query(
        "SELECT count(*) n FROM ts.lecturas WHERE nodo_id=$1 AND seq=9999",
        [nodoId],
      );
      return Number(r.rows[0].n) === 1;
    });
    await new Promise((r) => setTimeout(r, 800));
    expect(await contarEvaluaciones(nodoId)).toBe(antes);
    expect((await estadoDe(nodoId)).nivel).toBe(estadoAntes.nivel);
    expect((await estadoDe(nodoId)).ultima_lectura_en).toEqual(estadoAntes.ultima_lectura_en);
  });

  describe("SSE por espacio", () => {
    interface EventoSse {
      evento: string;
      datos: unknown;
    }

    /** Cliente SSE mínimo sobre `fetch` en streaming (como lo hará la PWA, con cabeceras). */
    async function abrirSse(url: string, token: string | null) {
      const control = new AbortController();
      const respuesta = await fetch(url, {
        headers: { ...(token ? { authorization: token } : {}), accept: "text/event-stream" },
        signal: control.signal,
      });
      const eventos: EventoSse[] = [];
      if (respuesta.status === 200 && respuesta.body) {
        const lector = respuesta.body.getReader();
        const decodificador = new TextDecoder();
        let bufer = "";
        void (async () => {
          try {
            for (;;) {
              const { value, done } = await lector.read();
              if (done) break;
              bufer += decodificador.decode(value, { stream: true });
              let corte = bufer.indexOf("\n\n");
              while (corte >= 0) {
                const bloque = bufer.slice(0, corte);
                bufer = bufer.slice(corte + 2);
                const evento = /^event: (.+)$/m.exec(bloque)?.[1];
                const datos = /^data: (.+)$/m.exec(bloque)?.[1];
                if (evento && datos) eventos.push({ evento, datos: JSON.parse(datos) });
                corte = bufer.indexOf("\n\n");
              }
            }
          } catch {
            // conexión cerrada por la prueba
          }
        })();
      }
      return {
        status: respuesta.status,
        eventos,
        tipo: respuesta.headers.get("content-type"),
        cuerpo: respuesta.status === 200 ? null : await respuesta.json(),
        cerrar: () => control.abort(),
      };
    }

    it("entrega snapshot y cambios en vivo, solo del espacio, y otro usuario recibe 404", async () => {
      const api = await crearApi(cfgApi(), log, { verificador: verificadorDePrueba });
      await api.app.listen({ port: 0, host: "127.0.0.1" });
      const direccion = api.app.server.address();
      const puerto = typeof direccion === "object" && direccion ? direccion.port : 0;
      const url = (espacio: string) => `http://127.0.0.1:${puerto}/api/espacios/${espacio}/eventos`;
      const abiertos: { cerrar(): void }[] = [];
      try {
        const ana = await abrirSse(url(ID.espacioAna), TOKEN.ana);
        abiertos.push(ana);
        expect(ana.status).toBe(200);
        expect(ana.tipo).toMatch(/text\/event-stream/);

        // snapshot: todos los nodos del espacio, con el estado que dejaron los escenarios
        const snapshot = await esperar(async () =>
          ana.eventos.find((e) => e.evento === "snapshot"),
        );
        const nodos = (snapshot.datos as { nodos: EstadoNodoEvento[] }).nodos;
        expect(nodos.length).toBe(HISTORIAS.length + 1);
        const iTurbidez = HISTORIAS.findIndex((e) => e.nombre === "turbidez_sube");
        const deTurbidez = nodos.find((n) => n.nodo_id === ID.nodoDe(iTurbidez));
        expect(deTurbidez).toMatchObject({ nivel: "critica", parametro_limitante: "turbidez" });
        expect(deTurbidez?.causa).toMatch(/turbia/);
        expect(nodos.some((n) => n.nodo_id === ID.nodoBeto)).toBe(false);

        // Beto ve solo lo suyo; el espacio de Ana le da 404 igual que uno inexistente
        const beto = await abrirSse(url(ID.espacioBeto), TOKEN.beto);
        abiertos.push(beto);
        expect(beto.status).toBe(200);
        const ajeno = await abrirSse(url(ID.espacioAna), TOKEN.beto);
        const inexistente = await abrirSse(url(uuid(0xdead)), TOKEN.beto);
        expect(ajeno.status).toBe(404);
        expect(inexistente.status).toBe(404);
        expect(ajeno.cuerpo).toEqual(inexistente.cuerpo);
        const anonimo = await abrirSse(url(ID.espacioAna), null);
        expect(anonimo.status).toBe(401);

        // cambios en vivo: un nodo de cada espacio publica un escenario
        const ph = HISTORIAS.find((e) => e.nombre === "ph_alcalino_salto") as Historia;
        await Promise.all([correrHistoria(ph, ID.nodoSse), correrHistoria(ph, ID.nodoBeto)]);

        const critica = await esperar(async () =>
          ana.eventos.find(
            (e) =>
              e.evento === "estado" &&
              (e.datos as EstadoNodoEvento).nodo_id === ID.nodoSse &&
              (e.datos as EstadoNodoEvento).nivel === "critica",
          ),
        );
        expect((critica.datos as EstadoNodoEvento).parametro_limitante).toBe("ph");
        expect((critica.datos as EstadoNodoEvento).accion).toMatch(/beber o cocinar/);
        await esperar(async () =>
          beto.eventos.find(
            (e) =>
              e.evento === "estado" &&
              (e.datos as EstadoNodoEvento).nodo_id === ID.nodoBeto &&
              (e.datos as EstadoNodoEvento).nivel === "critica",
          ),
        );

        // conexión (RF-13): el snapshot trae la de cada nodo del espacio y el stream avisa cuando el nodo
        // entra y cuando se despide; cada quien recibe solo la de su espacio
        const conexiones = (snapshot.datos as { conexiones: ConexionNodo[] }).conexiones;
        expect(conexiones.map((c) => c.nodo_id).sort()).toEqual(nodos.map((n) => n.nodo_id).sort());
        expect(conexiones.some((c) => c.nodo_id === ID.nodoBeto)).toBe(false);
        const conexionDe = (nodoId: string, conectado: boolean) => (e: EventoSse) =>
          e.evento === "conexion" &&
          (e.datos as EventoConexion).nodo_id === nodoId &&
          (e.datos as EventoConexion).conectado === conectado;
        const entro = await esperar(async () => ana.eventos.find(conexionDe(ID.nodoSse, true)));
        expect(entro.datos).toMatchObject({ espacio_id: ID.espacioAna });
        const salio = await esperar(async () => ana.eventos.find(conexionDe(ID.nodoSse, false)));
        expect(ana.eventos.indexOf(entro)).toBeLessThan(ana.eventos.indexOf(salio));
        expect(
          eventoConexion.safeParse(salio.datos).success &&
            eventoConexion.safeParse(entro.datos).success,
        ).toBe(true);
        expect((await estadoDe(ID.nodoSse)).conectado).toBe(false);
        await esperar(async () => beto.eventos.find(conexionDe(ID.nodoBeto, false)));
        const conexionesAna = ana.eventos
          .filter((e) => e.evento === "conexion")
          .map((e) => e.datos as EventoConexion);
        expect(conexionesAna.every((c) => c.espacio_id === ID.espacioAna)).toBe(true);
        expect(conexionesAna.some((c) => c.nodo_id === ID.nodoBeto)).toBe(false);

        // aislamiento del canal: cada quien recibe solo los eventos de su espacio
        const deAna = ana.eventos
          .filter((e) => e.evento === "estado")
          .map((e) => e.datos as EstadoNodoEvento);
        const deBeto = beto.eventos
          .filter((e) => e.evento === "estado")
          .map((e) => e.datos as EstadoNodoEvento);
        expect(deAna.length).toBeGreaterThan(0);
        expect(deAna.every((n) => n.espacio_id === ID.espacioAna)).toBe(true);
        expect(deBeto.every((n) => n.espacio_id === ID.espacioBeto)).toBe(true);

        // sin parpadeo también en el stream: los niveles que recibió Ana para ese nodo, sin repetidos
        const niveles = deAna.filter((n) => n.nodo_id === ID.nodoSse).map((n) => n.nivel);
        const sinRepetir = niveles.filter((n, k) => n !== niveles[k - 1]);
        expect(sinRepetir.at(-1)).toBe("critica");
        expect(sinRepetir.filter((n) => n === "critica")).toHaveLength(1);
      } finally {
        // cerrar la API no debe quedarse esperando a las conexiones SSE que siguen abiertas
        const inicioCierre = Date.now();
        await api.cerrar();
        expect(Date.now() - inicioCierre).toBeLessThan(5000);
        for (const a of abiertos) a.cerrar();
      }
    }, 90_000);
  });
});
