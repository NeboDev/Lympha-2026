import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  aplicarCiclo,
  barrer,
  type EstadoConfirmado,
  resolverSinConexion,
} from "../src/modules/alarmas/index.ts";
import { aplicarEvento } from "../src/modules/telemetria/index.ts";
import { type BdSistema, conSistema, crearBdSistema } from "../src/platform/db.ts";
import { migrar } from "../src/platform/migrar.ts";
import { iniciarPostgres, type PostgresDePrueba } from "./helpers/contenedores.ts";

/**
 * Desconexión sostenida, reconexión y recordatorios (H3) contra Postgres real. El barrido recibe "ahora" como
 * parámetro, así que el tiempo se adelanta sin esperar.
 */

const ID = {
  ana: "0192f3a7-0000-7000-8000-00000000a001", // Telegram, recordatorio cada 2 h
  beto: "0192f3a7-0000-7000-8000-00000000b001", // Telegram, valores por defecto (6 h)
  carla: "0192f3a7-0000-7000-8000-00000000c001", // sin Telegram
  dani: "0192f3a7-0000-7000-8000-00000000d001", // se vincula después de que se abre una alarma
  espacio: "0192f3a7-0000-7000-8000-00000000a0e1",
  lote: "0192f3a7-0000-7000-8000-0000000000f1",
};
const nodoN = (n: number) => `0192f3a7-0000-7000-8000-00000000e0${String(n).padStart(2, "0")}`;
const MIN = 60_000;
const HORA = 60 * MIN;

let pgc: PostgresDePrueba;
let owner: pg.Client;
let bd: BdSistema;

beforeAll(async () => {
  pgc = await iniciarPostgres();
  await migrar(pgc.url("owner"));
  owner = new pg.Client({ connectionString: pgc.url("owner") });
  await owner.connect();
  const nodos = Array.from({ length: 16 }, (_, i) => nodoN(i + 1));
  await owner.query(
    `INSERT INTO app.usuarios (id, auth_uid, email, nombre) VALUES
       ('${ID.ana}', 'uid-ana', 'ana@example.com', 'Ana'),
       ('${ID.beto}', 'uid-beto', 'beto@example.com', 'Beto'),
       ('${ID.carla}', 'uid-carla', 'carla@example.com', 'Carla'),
       ('${ID.dani}', 'uid-dani', 'dani@example.com', 'Dani');
     INSERT INTO app.espacios (id, nombre, tipo) VALUES ('${ID.espacio}', 'Casa', 'hogar');
     INSERT INTO app.membresias (espacio_id, usuario_id, rol) VALUES
       ('${ID.espacio}', '${ID.ana}', 'propietario'), ('${ID.espacio}', '${ID.beto}', 'miembro'),
       ('${ID.espacio}', '${ID.carla}', 'miembro'), ('${ID.espacio}', '${ID.dani}', 'miembro');
     INSERT INTO app.vinculos_telegram (usuario_id, chat_id) VALUES ('${ID.ana}', 111), ('${ID.beto}', 222);
     INSERT INTO app.preferencias_notificacion (usuario_id, nodo_id, recordatorio_h) VALUES ('${ID.ana}', NULL, 2);
     INSERT INTO app.lotes (id, cantidad, version_hw) VALUES ('${ID.lote}', 16, 'v1');
     INSERT INTO app.nodos (id, lote_id, espacio_id, estado, claim_hash, nombre) VALUES
       ${nodos.map((n, i) => `('${n}', '${ID.lote}', '${ID.espacio}', 'activo', '\\x00', ${i === 0 ? "'Cisterna'" : "NULL"})`).join(",")};
     INSERT INTO app.estado_nodo (nodo_id, espacio_id) VALUES ${nodos.map((n) => `('${n}', '${ID.espacio}')`).join(",")};`,
  );
  bd = crearBdSistema(pgc.url("system"), "prueba", 5);
});

afterAll(async () => {
  await bd?.cerrar();
  await owner?.end();
  await pgc?.detener();
});

/** El nodo se desconectó en `desdeMs` (o nunca se ha conectado, con `null`). */
const desconectar = (nodo: string, desdeMs: number | null) =>
  owner.query(
    `UPDATE app.estado_nodo SET conectado = false, cambio_conexion_en = $2 WHERE nodo_id = $1`,
    [nodo, desdeMs === null ? null : new Date(desdeMs)],
  );

const alarmas = async (nodo: string, tipo: string) =>
  (
    await owner.query<{ id: string; estado: string }>(
      "SELECT id, estado FROM app.alarmas WHERE nodo_id = $1 AND tipo = $2 ORDER BY abierta_en",
      [nodo, tipo],
    )
  ).rows;

interface Aviso {
  usuario: string;
  evento: string;
  texto: string;
}
const avisosDe = async (alarmaId: string): Promise<Aviso[]> =>
  (
    await owner.query<{ usuario_id: string; evento: string; texto: string }>(
      `SELECT usuario_id, evento, payload->>'texto' AS texto FROM app.notificaciones_salida
       WHERE alarma_id = $1 ORDER BY creado_en, evento, usuario_id`,
      [alarmaId],
    )
  ).rows.map((f) => ({
    usuario: f.usuario_id === ID.ana ? "ana" : f.usuario_id === ID.beto ? "beto" : "otro",
    evento: f.evento,
    texto: f.texto,
  }));

describe("desconexión sostenida (RF-29)", () => {
  it("alarma solo cuando pasa el tiempo del perfil (10 min) y avisa una sola vez", async () => {
    const nodo = nodoN(1);
    const t0 = Date.now();
    await desconectar(nodo, t0);

    expect((await barrer(bd, t0 + 5 * MIN)).eventos).toEqual([]);
    expect(await alarmas(nodo, "sin_conexion")).toEqual([]);

    const r = await barrer(bd, t0 + 11 * MIN);
    expect(r.eventos.map((e) => [e.tipo, e.cambio, e.estado])).toEqual([
      ["sin_conexion", "abierta", "activa"],
    ]);
    const [alarma] = await alarmas(nodo, "sin_conexion");
    expect(alarma?.estado).toBe("activa");
    const avisos = await avisosDe(alarma?.id as string);
    expect(avisos.map((a) => `${a.evento}:${a.usuario}`)).toEqual([
      "sin_conexion:ana",
      "sin_conexion:beto",
    ]);
    expect(avisos[0]?.texto).toContain("Cisterna · Casa");
    expect(avisos[0]?.texto).toContain("Sin conexión desde hace 11 min");
    expect(avisos[0]?.texto).not.toMatch(/potable|\bseguro\b/i);

    // barridos posteriores no repiten la alarma ni el aviso
    expect((await barrer(bd, t0 + 12 * MIN)).avisos).toBe(0);
    expect(await alarmas(nodo, "sin_conexion")).toHaveLength(1);
  });

  it("un nodo que nunca se conectó, o que sigue conectado, no alarma", async () => {
    const nuncaConectado = nodoN(2);
    const conectado = nodoN(3);
    const t0 = Date.now();
    await desconectar(nuncaConectado, null);
    await owner.query(
      "UPDATE app.estado_nodo SET conectado = true, cambio_conexion_en = $2 WHERE nodo_id = $1",
      [conectado, new Date(t0 - 5 * HORA)],
    );
    await barrer(bd, t0 + 2 * HORA);
    expect(await alarmas(nuncaConectado, "sin_conexion")).toEqual([]);
    expect(await alarmas(conectado, "sin_conexion")).toEqual([]);
  });

  it("el tiempo configurable por variable sustituye al del perfil", async () => {
    const nodo = nodoN(4);
    const t0 = Date.now();
    await desconectar(nodo, t0);
    expect((await barrer(bd, t0 + 20_000, { sinConexionS: 30 })).eventos).toEqual([]);
    expect((await barrer(bd, t0 + 31_000, { sinConexionS: 30 })).eventos).toHaveLength(1);
  });

  it("un nodo que cae sin despedirse (Last Will) llega hasta la alarma por el camino real", async () => {
    const nodo = nodoN(5);
    const t0 = Date.now();
    // El broker publica `offline` (el nodo no avisó): ingest lo encola y el worker lo aplica.
    const evento = {
      tipo: "estado" as const,
      nodoId: nodo,
      espacioId: ID.espacio,
      estado: "offline" as const,
      recibidoEn: t0,
    };
    expect(await aplicarEvento(bd, { ...evento, estado: "online", recibidoEn: t0 - MIN })).toBe(
      "conectado",
    );
    expect(await aplicarEvento(bd, evento)).toBe("desconectado");
    expect(await aplicarEvento(bd, evento)).toBeNull(); // repetido: nada cambia
    await barrer(bd, t0 + 11 * MIN);
    expect(await alarmas(nodo, "sin_conexion")).toHaveLength(1);
  });
});

describe("reconexión", () => {
  it("al volver se cierra la alarma y se avisa solo a quien ya había sido avisado", async () => {
    const nodo = nodoN(6);
    const t0 = Date.now();
    await desconectar(nodo, t0);
    await barrer(bd, t0 + 11 * MIN);
    const [alarma] = await alarmas(nodo, "sin_conexion");

    // Dani vincula Telegram DESPUÉS de que se abrió la alarma: no se entera de algo que no vio empezar.
    await owner.query("INSERT INTO app.vinculos_telegram (usuario_id, chat_id) VALUES ($1, 444)", [
      ID.dani,
    ]);
    try {
      const r = await resolverSinConexion(bd, nodo, t0 + 15 * MIN);
      expect(r?.evento).toMatchObject({
        tipo: "sin_conexion",
        cambio: "resuelta",
        estado: "resuelta",
      });
      expect((await alarmas(nodo, "sin_conexion"))[0]?.estado).toBe("resuelta");
      const avisos = await avisosDe(alarma?.id as string);
      expect(avisos.map((a) => `${a.evento}:${a.usuario}`)).toEqual([
        "sin_conexion:ana",
        "sin_conexion:beto",
        "reconectado:ana",
        "reconectado:beto",
      ]);
      expect(avisos.at(-1)?.texto).toContain("volvió a conectarse");
      // sin alarma abierta no hay nada que cerrar
      expect(await resolverSinConexion(bd, nodo, t0 + 16 * MIN)).toBeNull();
    } finally {
      await owner.query("DELETE FROM app.vinculos_telegram WHERE usuario_id = $1", [ID.dani]);
    }
  });

  it("si se pierde el evento 'online', el barrido cierra la alarma de un nodo ya conectado", async () => {
    const nodo = nodoN(7);
    const t0 = Date.now();
    await desconectar(nodo, t0);
    await barrer(bd, t0 + 11 * MIN);
    await owner.query("UPDATE app.estado_nodo SET conectado = true WHERE nodo_id = $1", [nodo]);
    const r = await barrer(bd, t0 + 12 * MIN);
    expect(r.eventos.map((e) => [e.tipo, e.cambio])).toEqual([["sin_conexion", "resuelta"]]);
    expect((await alarmas(nodo, "sin_conexion"))[0]?.estado).toBe("resuelta");
  });

  it("volver a caer después abre una alarma nueva", async () => {
    const nodo = nodoN(8);
    const t0 = Date.now();
    await desconectar(nodo, t0);
    await barrer(bd, t0 + 11 * MIN);
    await resolverSinConexion(bd, nodo, t0 + 12 * MIN);
    await desconectar(nodo, t0 + 20 * MIN);
    await barrer(bd, t0 + 31 * MIN);
    expect((await alarmas(nodo, "sin_conexion")).map((a) => a.estado)).toEqual([
      "resuelta",
      "activa",
    ]);
  });
});

describe("recordatorios (RF-30)", () => {
  // El barrido mira todo Postgres: cada prueba parte sin alarmas abiertas ni nodos caídos de las anteriores.
  beforeEach(async () => {
    await owner.query("UPDATE app.estado_nodo SET conectado = true");
    await owner.query(
      "UPDATE app.alarmas SET estado = 'resuelta', resuelta_en = now() WHERE estado <> 'resuelta'",
    );
  });

  const estadoMala = (nodo: string, ts: number): EstadoConfirmado => ({
    nodoId: nodo,
    espacioId: ID.espacio,
    ts,
    nivel: "mala",
    wqi: 50,
    confianza: "ok",
    parametroLimitante: "turbidez",
    causa: "La turbidez está por encima del límite.",
    accion: "Revisa el filtro.",
    valores: {},
  });

  it("cada usuario recibe su recordatorio a las horas que eligió, sin repetirlo en cada barrido", async () => {
    const nodo = nodoN(9);
    const t0 = Date.now();
    await conSistema(bd, (tx) => aplicarCiclo(tx, [estadoMala(nodo, t0)], t0 + 1000));
    const [alarma] = await alarmas(nodo, "nivel");
    const id = alarma?.id as string;
    const eventos = async () => (await avisosDe(id)).map((a) => `${a.evento}:${a.usuario}`);
    expect(await eventos()).toEqual(["abierta:ana", "abierta:beto"]);

    expect((await barrer(bd, t0 + 1 * HORA)).avisos).toBe(0);

    // a las 2 h solo Ana (su preferencia); Beto usa las 6 h por defecto
    expect((await barrer(bd, t0 + 2 * HORA + MIN)).avisos).toBe(1);
    expect((await barrer(bd, t0 + 2 * HORA + 2 * MIN)).avisos).toBe(0);
    expect(await eventos()).toEqual(["abierta:ana", "abierta:beto", "recordatorio:ana"]);
    const recordatorio = (await avisosDe(id)).find((a) => a.evento === "recordatorio");
    expect(recordatorio?.texto).toContain("Recordatorio: la calidad sigue mala desde hace 2 h");
    expect(recordatorio?.texto).toContain("Causa: La turbidez está por encima del límite.");

    // la siguiente de Ana, 2 h después; la de Beto, a las 6 h
    expect((await barrer(bd, t0 + 4 * HORA + 3 * MIN)).avisos).toBe(1);
    const a6 = await barrer(bd, t0 + 6 * HORA + 4 * MIN);
    expect(a6.avisos).toBe(2); // Ana (otra vez) y Beto
    expect((await eventos()).filter((e) => e === "recordatorio:beto")).toHaveLength(1);
  });

  const estadoCritica = (nodo: string, ts: number): EstadoConfirmado => ({
    ...estadoMala(nodo, ts),
    nivel: "critica",
    wqi: 10,
  });

  it("una alarma crítica recuerda cada 2 h a quien no eligió otro intervalo, y respeta al que sí", async () => {
    const nodo = nodoN(14);
    const t0 = Date.now();
    // Beto eligió 12 h: ese valor es suyo. Ana (2 h) y Beto ya tenían preferencia distinta de las 6 h por defecto.
    await owner.query(
      `INSERT INTO app.preferencias_notificacion (usuario_id, nodo_id, recordatorio_h)
       VALUES ('${ID.beto}', NULL, 12)
       ON CONFLICT (usuario_id, nodo_id) DO UPDATE SET recordatorio_h = 12`,
    );
    try {
      await conSistema(bd, (tx) => aplicarCiclo(tx, [estadoCritica(nodo, t0)], t0 + 1000));
      const [alarma] = await alarmas(nodo, "nivel");
      const r = await barrer(bd, t0 + 2 * HORA + MIN);
      expect(r.avisos).toBe(1);
      expect((await avisosDe(alarma?.id as string)).map((a) => `${a.evento}:${a.usuario}`)).toEqual(
        ["abierta:ana", "abierta:beto", "recordatorio:ana"],
      );
    } finally {
      await owner.query(
        "DELETE FROM app.preferencias_notificacion WHERE usuario_id = $1 AND nodo_id IS NULL",
        [ID.beto],
      );
    }
  });

  it("una alarma crítica recuerda a las 2 h a quien tiene el intervalo por defecto (6 h)", async () => {
    const nodo = nodoN(15);
    const t0 = Date.now();
    await conSistema(bd, (tx) => aplicarCiclo(tx, [estadoCritica(nodo, t0)], t0 + 1000));
    const [alarma] = await alarmas(nodo, "nivel");
    expect((await barrer(bd, t0 + 1 * HORA)).avisos).toBe(0);
    expect((await barrer(bd, t0 + 2 * HORA + MIN)).avisos).toBe(2); // Ana (2 h) y Beto (por defecto → 2 h)
    expect((await avisosDe(alarma?.id as string)).filter((a) => a.usuario === "beto")).toHaveLength(
      2,
    );
  });

  it("quien vincula Telegram con una alarma ya abierta la recibe en el siguiente barrido, una sola vez", async () => {
    const nodo = nodoN(16);
    const t0 = Date.now();
    await conSistema(bd, (tx) => aplicarCiclo(tx, [estadoCritica(nodo, t0)], t0 + 1000));
    const [alarma] = await alarmas(nodo, "nivel");
    const id = alarma?.id as string;
    expect((await avisosDe(id)).map((a) => a.usuario)).toEqual(["ana", "beto"]);

    await owner.query("INSERT INTO app.vinculos_telegram (usuario_id, chat_id) VALUES ($1, 444)", [
      ID.dani,
    ]);
    try {
      // Carla (sin Telegram) no recibe nada; Dani recibe un recordatorio sin esperar las horas
      expect((await barrer(bd, t0 + 2 * MIN)).avisos).toBe(1);
      const nuevos = (await avisosDe(id)).filter((a) => a.evento === "recordatorio");
      expect(nuevos.map((a) => a.usuario)).toEqual(["otro"]);
      expect(nuevos[0]?.texto).toContain("Recordatorio: la calidad sigue crítica");
      expect((await barrer(bd, t0 + 3 * MIN)).avisos).toBe(0);
    } finally {
      await owner.query("DELETE FROM app.vinculos_telegram WHERE usuario_id = $1", [ID.dani]);
    }
  });

  it("una alarma atendida deja de recordar", async () => {
    const nodo = nodoN(10);
    const t0 = Date.now();
    await conSistema(bd, (tx) => aplicarCiclo(tx, [estadoMala(nodo, t0)], t0 + 1000));
    const [alarma] = await alarmas(nodo, "nivel");
    await owner.query(
      "UPDATE app.alarmas SET estado = 'atendida', atendida_por = $2, atendida_en = now() WHERE id = $1",
      [alarma?.id, ID.carla],
    );
    expect((await barrer(bd, t0 + 8 * HORA)).avisos).toBe(0);
    expect(await avisosDe(alarma?.id as string)).toHaveLength(2);
  });

  it("respeta los niveles que el usuario eligió: si no quiere 'mala', no recibe el recordatorio", async () => {
    const nodo = nodoN(11);
    const t0 = Date.now();
    await owner.query(
      "INSERT INTO app.preferencias_notificacion (usuario_id, nodo_id, niveles, recordatorio_h) VALUES ($1, $2, '{critica}', 1)",
      [ID.beto, nodo],
    );
    await conSistema(bd, (tx) => aplicarCiclo(tx, [estadoMala(nodo, t0)], t0 + 1000));
    const [alarma] = await alarmas(nodo, "nivel");
    // Beto solo quiere críticas: ni aviso de apertura ni recordatorios
    expect((await avisosDe(alarma?.id as string)).map((a) => a.usuario)).toEqual(["ana"]);
    await barrer(bd, t0 + 3 * HORA);
    expect((await avisosDe(alarma?.id as string)).filter((a) => a.usuario === "beto")).toEqual([]);
  });

  it("también recuerda las alarmas de desconexión y de sensor", async () => {
    const nodo = nodoN(12);
    const t0 = Date.now();
    await desconectar(nodo, t0);
    await barrer(bd, t0 + 11 * MIN);
    const r = await barrer(bd, t0 + 2 * HORA + 12 * MIN);
    expect(r.avisos).toBe(1); // Ana a las 2 h; Beto a las 6 h
    const [alarma] = await alarmas(nodo, "sin_conexion");
    const rec = (await avisosDe(alarma?.id as string)).find((a) => a.evento === "recordatorio");
    expect(rec?.texto).toContain("Sigue sin conexión desde hace 2 h");
  });

  it("el recordatorio respeta el horario silencioso: se difiere, no se pierde", async () => {
    const nodo = nodoN(13);
    // Beto duerme de 22:00 a 07:00 (Ciudad de México). Alarma a las 20:00 locales (02:00 UTC); a las 6 h son las 02:00 locales.
    const t0 = Date.UTC(2026, 9, 14, 2, 0, 0);
    await owner.query(
      `INSERT INTO app.preferencias_notificacion (usuario_id, nodo_id, silencio_inicio, silencio_fin)
       VALUES ('${ID.beto}', NULL, '22:00', '07:00')
       ON CONFLICT (usuario_id, nodo_id) DO UPDATE SET silencio_inicio = '22:00', silencio_fin = '07:00'`,
    );
    try {
      await conSistema(bd, (tx) => aplicarCiclo(tx, [estadoMala(nodo, t0)], t0 + 1000));
      const [alarma] = await alarmas(nodo, "nivel");
      await owner.query("UPDATE app.alarmas SET abierta_en = $2 WHERE id = $1", [
        alarma?.id,
        new Date(t0),
      ]);
      await barrer(bd, t0 + 6 * HORA + MIN);
      const fila = (
        await owner.query<{ enviar_despues_de: Date }>(
          `SELECT enviar_despues_de FROM app.notificaciones_salida
           WHERE alarma_id = $1 AND usuario_id = $2 AND evento = 'recordatorio'`,
          [alarma?.id, ID.beto],
        )
      ).rows[0];
      // 02:01 locales → sale a las 07:00 locales = 13:00 UTC
      expect(fila?.enviar_despues_de.toISOString()).toBe("2026-10-14T13:00:00.000Z");
    } finally {
      await owner.query(
        "DELETE FROM app.preferencias_notificacion WHERE usuario_id = $1 AND nodo_id IS NULL",
        [ID.beto],
      );
    }
  });
});
