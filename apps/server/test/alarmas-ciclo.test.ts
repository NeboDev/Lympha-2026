import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aplicarCiclo, type EstadoConfirmado } from "../src/modules/alarmas/index.ts";
import { guardarEvaluaciones } from "../src/modules/calidad/repo.ts";
import { type BdSistema, conSistema, crearBdSistema } from "../src/platform/db.ts";
import { migrar } from "../src/platform/migrar.ts";
import { iniciarPostgres, type PostgresDePrueba } from "./helpers/contenedores.ts";

/**
 * Ciclo de vida de las alarmas (H3) contra Postgres real: apertura, escalada, mejora, resolución, atención,
 * sensor, datos viejos, horario silencioso, idempotencia ante reintentos y atomicidad con el estado.
 */

const ID = {
  ana: "0192f3a7-0000-7000-8000-00000000a001", // propietaria, Telegram vinculado, preferencias por defecto
  beto: "0192f3a7-0000-7000-8000-00000000b001", // miembro, Telegram vinculado, solo quiere críticas
  carla: "0192f3a7-0000-7000-8000-00000000c001", // miembro sin Telegram
  espacio: "0192f3a7-0000-7000-8000-00000000a0e1",
  lote: "0192f3a7-0000-7000-8000-0000000000f1",
};
const nodoN = (n: number) => `0192f3a7-0000-7000-8000-00000000d0${String(n).padStart(2, "0")}`;

let pgc: PostgresDePrueba;
let owner: pg.Client;
let bd: BdSistema;

beforeAll(async () => {
  pgc = await iniciarPostgres();
  await migrar(pgc.url("owner"));
  owner = new pg.Client({ connectionString: pgc.url("owner") });
  await owner.connect();
  const nodos = Array.from({ length: 14 }, (_, i) => nodoN(i + 1));
  await owner.query(
    `INSERT INTO app.usuarios (id, auth_uid, email, nombre) VALUES
       ('${ID.ana}', 'uid-ana', 'ana@example.com', 'Ana'),
       ('${ID.beto}', 'uid-beto', 'beto@example.com', 'Beto'),
       ('${ID.carla}', 'uid-carla', 'carla@example.com', 'Carla');
     INSERT INTO app.espacios (id, nombre, tipo) VALUES ('${ID.espacio}', 'Casa', 'hogar');
     INSERT INTO app.membresias (espacio_id, usuario_id, rol) VALUES
       ('${ID.espacio}', '${ID.ana}', 'propietario'),
       ('${ID.espacio}', '${ID.beto}', 'miembro'),
       ('${ID.espacio}', '${ID.carla}', 'miembro');
     INSERT INTO app.vinculos_telegram (usuario_id, chat_id) VALUES ('${ID.ana}', 111), ('${ID.beto}', 222);
     INSERT INTO app.preferencias_notificacion (usuario_id, nodo_id, niveles) VALUES ('${ID.beto}', NULL, '{critica}');
     INSERT INTO app.lotes (id, cantidad, version_hw) VALUES ('${ID.lote}', 14, 'v1');
     INSERT INTO app.nodos (id, lote_id, espacio_id, estado, claim_hash, nombre) VALUES
       ${nodos.map((n, i) => `('${n}', '${ID.lote}', '${ID.espacio}', 'activo', '\\x00', ${i === 0 ? "'Cisterna'" : "NULL"})`).join(",")};
     INSERT INTO app.estado_nodo (nodo_id, espacio_id) VALUES
       ${nodos.map((n) => `('${n}', '${ID.espacio}')`).join(",")};`,
  );
  bd = crearBdSistema(pgc.url("system"), "prueba", 5);
});

afterAll(async () => {
  await bd?.cerrar();
  await owner?.end();
  await pgc?.detener();
});

const T0 = Date.UTC(2026, 9, 13, 15, 0, 0);

function estado(
  nodoId: string,
  nivel: EstadoConfirmado["nivel"],
  ts: number,
  extra: Partial<EstadoConfirmado> = {},
): EstadoConfirmado {
  return {
    nodoId,
    espacioId: ID.espacio,
    ts,
    nivel,
    wqi: nivel === "critica" ? 20 : nivel === "mala" ? 50 : 70,
    confianza: "ok",
    parametroLimitante: "turbidez",
    causa: "La turbidez está por encima del límite.",
    accion: "Evita usarla para beber o cocinar hasta revisar el filtro.",
    valores: { ph: 7.1, temperatura: 22, conductividad: 600, turbidez: 9, tds: 300 },
    ...extra,
  };
}

/** Una pasada del ciclo, como la haría el worker, con "ahora" un segundo después de la lectura. */
const aplicar = (estados: EstadoConfirmado[], ahora?: number) =>
  conSistema(bd, (tx) =>
    aplicarCiclo(tx, estados, ahora ?? Math.max(...estados.map((e) => e.ts)) + 1000),
  );

interface FilaAlarma {
  id: string;
  tipo: string;
  severidad: string;
  estado: string;
  escalada_en: Date | null;
  resuelta_en: Date | null;
  detalle: Record<string, unknown>;
}
const alarmasDe = async (nodo: string): Promise<FilaAlarma[]> =>
  (
    await owner.query<FilaAlarma>(
      "SELECT id, tipo, severidad, estado, escalada_en, resuelta_en, detalle FROM app.alarmas WHERE nodo_id = $1 ORDER BY abierta_en, id",
      [nodo],
    )
  ).rows;

interface FilaSalida {
  usuario_id: string;
  evento: string;
  estado: string;
  texto: string;
  enviar_despues_de: Date;
  creado_en: Date;
}
const salidaDe = async (alarmaId: string): Promise<FilaSalida[]> =>
  (
    await owner.query<FilaSalida>(
      `SELECT usuario_id, evento, estado, payload->>'texto' AS texto, enviar_despues_de, creado_en
       FROM app.notificaciones_salida WHERE alarma_id = $1 ORDER BY creado_en, evento, usuario_id`,
      [alarmaId],
    )
  ).rows;
const resumen = (filas: FilaSalida[]) =>
  filas.map(
    (f) =>
      `${f.evento}:${f.usuario_id === ID.ana ? "ana" : f.usuario_id === ID.beto ? "beto" : "otro"}`,
  );

describe("alarma de nivel", () => {
  it("abre una alarma, avisa solo a quien la quiere y respeta quién tiene Telegram", async () => {
    const nodo = nodoN(1);
    const r = await aplicar([estado(nodo, "mala", T0)]);
    expect(r.eventos.map((e) => [e.cambio, e.severidad, e.estado])).toEqual([
      ["abierta", "mala", "activa"],
    ]);

    const [alarma] = await alarmasDe(nodo);
    expect(alarma).toMatchObject({ tipo: "nivel", severidad: "mala", estado: "activa" });
    // Ana (mala y crítica por defecto) sí; Beto (solo críticas) no; Carla no tiene Telegram.
    const salida = await salidaDe((alarma as FilaAlarma).id);
    expect(resumen(salida)).toEqual(["abierta:ana"]);
    const texto = salida[0]?.texto ?? "";
    expect(texto).toContain("Cisterna · Casa");
    expect(texto).toContain("Calidad del agua mala");
    expect(texto).toContain("La turbidez está por encima del límite.");
    expect(texto).toContain("Evita usarla");
    expect(texto).not.toMatch(/potable|\bseguro\b|\bsegura\b/i);
  });

  it("un reintento de la misma evaluación no duplica la alarma ni el aviso (RF-30)", async () => {
    const nodo = nodoN(2);
    await aplicar([estado(nodo, "mala", T0)]);
    const otra = await aplicar([estado(nodo, "mala", T0)]);
    const otraMas = await aplicar([estado(nodo, "mala", T0 + 60_000)]);
    expect(otra).toMatchObject({ eventos: [], avisos: 0 });
    expect(otraMas).toMatchObject({ eventos: [], avisos: 0 });
    const alarmas = await alarmasDe(nodo);
    expect(alarmas).toHaveLength(1);
    expect(await salidaDe((alarmas[0] as FilaAlarma).id)).toHaveLength(1);
  });

  it("escala, mejora por escalones y se resuelve; cada transición avisa a quien corresponde", async () => {
    const nodo = nodoN(3);
    await aplicar([estado(nodo, "mala", T0)]);
    await aplicar([estado(nodo, "critica", T0 + 60_000)]);
    await aplicar([estado(nodo, "mala", T0 + 120_000)]);
    await aplicar([estado(nodo, "regular", T0 + 180_000)]);
    const fin = await aplicar([estado(nodo, "buena", T0 + 240_000)]);
    expect(fin.eventos.map((e) => e.cambio)).toEqual(["resuelta"]);

    const [alarma] = await alarmasDe(nodo);
    expect(alarma).toMatchObject({ severidad: "regular", estado: "resuelta" });
    expect(alarma?.resuelta_en).not.toBeNull();
    expect(alarma?.escalada_en).not.toBeNull();
    expect(alarma?.detalle.pico).toBe("critica");

    // ana: abierta(mala), escalada(crítica), mejorada(mala), mejorada(regular: antes mala), resuelta.
    // beto: solo críticas — la escalada a crítica y la mejora desde crítica (el nivel anterior estaba en su lista);
    //       la resolución llega porque ya recibió avisos de esta alarma.
    const salida = await salidaDe((alarma as FilaAlarma).id);
    const deAna = salida.filter((f) => f.usuario_id === ID.ana).map((f) => f.evento);
    const deBeto = salida.filter((f) => f.usuario_id === ID.beto).map((f) => f.evento);
    expect(deAna).toEqual(["abierta", "escalada", "mejorada", "mejorada", "resuelta"]);
    expect(deBeto).toEqual(["escalada", "mejorada", "resuelta"]);
    expect(salida.find((f) => f.evento === "mejorada")?.texto).toMatch(
      /Mejoró: calidad mala \(antes crítica\)/,
    );
    expect(salida.at(-1)?.texto).toContain("volvió a buena");
  });

  it("tras resolverse, un nuevo problema abre otra alarma", async () => {
    const nodo = nodoN(4);
    await aplicar([estado(nodo, "mala", T0)]);
    await aplicar([estado(nodo, "buena", T0 + 60_000)]);
    await aplicar([estado(nodo, "critica", T0 + 120_000)]);
    const alarmas = await alarmasDe(nodo);
    expect(alarmas.map((a) => [a.severidad, a.estado])).toEqual([
      ["mala", "resuelta"],
      ["critica", "activa"],
    ]);
  });

  it("empeorar reabre una alarma atendida; mejorar la deja atendida", async () => {
    const nodo = nodoN(5);
    await aplicar([estado(nodo, "regular", T0)]);
    const [alarma] = await alarmasDe(nodo);
    await owner.query(
      "UPDATE app.alarmas SET estado = 'atendida', atendida_por = $2, atendida_en = now() WHERE id = $1",
      [alarma?.id, ID.carla],
    );
    await aplicar([estado(nodo, "regular", T0 + 60_000)]);
    expect((await alarmasDe(nodo))[0]?.estado).toBe("atendida");

    const r = await aplicar([estado(nodo, "mala", T0 + 120_000)]);
    expect(r.eventos[0]).toMatchObject({ cambio: "escalada", estado: "activa" });
    const despues = (await alarmasDe(nodo))[0] as FilaAlarma;
    expect(despues.estado).toBe("activa");
    expect(despues.detalle.atencion_previa).toMatchObject({ por: ID.carla });
    const fila = await owner.query("SELECT atendida_por FROM app.alarmas WHERE id = $1", [
      alarma?.id,
    ]);
    expect(fila.rows[0].atendida_por).toBeNull();
  });

  it("sin_datos no abre, ni mejora, ni resuelve", async () => {
    const nodo = nodoN(6);
    expect(await aplicar([estado(nodo, "sin_datos", T0)])).toMatchObject({
      eventos: [],
      avisos: 0,
    });
    await aplicar([estado(nodo, "mala", T0 + 60_000)]);
    expect(await aplicar([estado(nodo, "sin_datos", T0 + 120_000)])).toMatchObject({
      eventos: [],
      avisos: 0,
    });
    expect((await alarmasDe(nodo))[0]?.estado).toBe("activa");
  });

  it("un dato viejo (más de 30 min) abre la alarma pero no avisa", async () => {
    const nodo = nodoN(7);
    const r = await aplicar([estado(nodo, "critica", T0)], T0 + 3 * 3_600_000);
    expect(r.eventos).toHaveLength(1);
    expect(r.avisos).toBe(0);
    const [alarma] = await alarmasDe(nodo);
    expect(await salidaDe((alarma as FilaAlarma).id)).toHaveLength(0);
  });

  it("el horario silencioso difiere el aviso, no lo pierde", async () => {
    const nodo = nodoN(8);
    // Ana duerme de 09:00 a 17:00 en Ciudad de México; T0 = 15:00 UTC = 09:00 local → dentro de la ventana.
    await owner.query(
      `INSERT INTO app.preferencias_notificacion (usuario_id, nodo_id, silencio_inicio, silencio_fin)
       VALUES ('${ID.ana}', NULL, '09:00', '17:00')`,
    );
    try {
      await aplicar([estado(nodo, "critica", T0)]);
      const [alarma] = await alarmasDe(nodo);
      const filas = await salidaDe((alarma as FilaAlarma).id);
      const deAna = filas.find((f) => f.usuario_id === ID.ana);
      expect(deAna?.estado).toBe("pendiente");
      expect(deAna?.enviar_despues_de.toISOString()).toBe("2026-10-13T23:00:00.000Z"); // 17:00 local
      // Beto no tiene horario: sale de inmediato.
      const deBeto = filas.find((f) => f.usuario_id === ID.beto);
      expect(deBeto && deBeto.enviar_despues_de.getTime() <= Date.now()).toBe(true);
    } finally {
      await owner.query(`DELETE FROM app.preferencias_notificacion WHERE usuario_id = '${ID.ana}'`);
    }
  });

  it("la alarma y su aviso son atómicos: si la transacción falla, no queda ninguno", async () => {
    const nodo = nodoN(9);
    await expect(
      conSistema(bd, async (tx) => {
        await aplicarCiclo(tx, [estado(nodo, "critica", T0)], T0 + 1000);
        throw new Error("falla después de escribir la alarma");
      }),
    ).rejects.toThrow(/falla después/);
    expect(await alarmasDe(nodo)).toHaveLength(0);
    const huerfanos = await owner.query(
      "SELECT 1 FROM app.notificaciones_salida WHERE payload->>'nodo_id' = $1",
      [nodo],
    );
    expect(huerfanos.rowCount).toBe(0);
  });

  it("al confirmar la transacción despierta al notifier con NOTIFY lympha_salida", async () => {
    const escucha = new pg.Client({ connectionString: pgc.url("system") });
    await escucha.connect();
    await escucha.query("LISTEN lympha_salida");
    const recibida = new Promise<string>((ok) =>
      escucha.once("notification", (m) => ok(m.channel)),
    );
    try {
      await aplicar([estado(nodoN(10), "critica", T0)]);
      expect(await recibida).toBe("lympha_salida");
    } finally {
      await escucha.end();
    }
  });
});

describe("lotes con varias lecturas de un nodo", () => {
  const evaluacion = (e: EstadoConfirmado) => ({
    nodoId: e.nodoId,
    espacioId: e.espacioId,
    ts: e.ts,
    wqi: e.wqi,
    nivel: e.nivel,
    parametroLimitante: e.parametroLimitante,
    confianza: e.confianza,
    versionAlgoritmo: "prueba",
    subindices: {},
  });

  it("sigue cada cambio de nivel del lote, y repetir el lote (reintento) no repite nada", async () => {
    const nodo = nodoN(13);
    const cambios = [
      estado(nodo, "regular", T0),
      estado(nodo, "mala", T0 + 60_000),
      estado(nodo, "critica", T0 + 120_000),
      estado(nodo, "mala", T0 + 180_000),
      estado(nodo, "buena", T0 + 240_000),
    ];
    const ahora = T0 + 250_000;
    // Lo que hace el evaluador: guardar las evaluaciones y estas alarmas en una sola transacción.
    const guardar = () =>
      guardarEvaluaciones(bd, cambios.map(evaluacion), [cambios.at(-1) as never], {
        cambios: cambios as never, // `valores` es `unknown` aquí y tipado en calidad: misma forma en tiempo de ejecución
        alGuardar: async (tx, c) => (await aplicarCiclo(tx, c, ahora)).eventos,
      });

    const primera = await guardar();
    expect(primera.map((e) => [e.cambio, e.severidad])).toEqual([
      ["abierta", "regular"],
      ["escalada", "mala"],
      ["escalada", "critica"],
      ["mejorada", "mala"],
      ["resuelta", "mala"],
    ]);
    const [alarma] = await alarmasDe(nodo);
    expect(alarma).toMatchObject({ estado: "resuelta", severidad: "mala" });
    expect(alarma?.detalle.pico).toBe("critica");
    // Ana (mala y crítica) no se entera de la apertura en regular; Beto (solo críticas) de la escalada a crítica
    const salida = await salidaDe((alarma as FilaAlarma).id);
    expect(
      salida.filter((f) => f.usuario_id === ID.ana).map((f) => f.evento),
      "Ana",
    ).toEqual(["escalada", "escalada", "mejorada", "resuelta"]);
    expect(
      salida.filter((f) => f.usuario_id === ID.beto).map((f) => f.evento),
      "Beto",
    ).toEqual(["escalada", "mejorada", "resuelta"]);

    // El reintento del mismo lote (la memoria de Valkey quedó vieja) no inserta evaluaciones nuevas: no hace nada.
    expect(await guardar()).toEqual([]);
    expect(await alarmasDe(nodo)).toHaveLength(1);
    expect(await salidaDe((alarma as FilaAlarma).id)).toHaveLength(salida.length);
  });
});

describe("alarma de sensor", () => {
  it("se abre con 'revisar', avisa a todos los vinculados sin importar los niveles y se cierra con 'ok'", async () => {
    const nodo = nodoN(11);
    const causa = "El sensor de pH no entrega lecturas válidas.";
    const r = await aplicar([
      estado(nodo, "sin_datos", T0, { confianza: "revisar", causa, parametroLimitante: "ph" }),
    ]);
    expect(r.eventos.map((e) => [e.tipo, e.cambio])).toEqual([["sensor", "abierta"]]);
    const [alarma] = await alarmasDe(nodo);
    expect(alarma).toMatchObject({ tipo: "sensor", estado: "activa" });
    const abierta = await salidaDe((alarma as FilaAlarma).id);
    expect(resumen(abierta)).toEqual(["abierta:ana", "abierta:beto"]);
    expect(abierta[0]?.texto).toContain("Revisa el sensor");

    // dudosa no cierra ni reabre
    expect(
      (await aplicar([estado(nodo, "sin_datos", T0 + 60_000, { confianza: "dudosa" })])).eventos,
    ).toEqual([]);
    expect((await alarmasDe(nodo))[0]?.estado).toBe("activa");

    const fin = await aplicar([estado(nodo, "buena", T0 + 120_000, { confianza: "ok" })]);
    expect(fin.eventos.map((e) => [e.tipo, e.cambio])).toEqual([["sensor", "resuelta"]]);
    expect((await alarmasDe(nodo))[0]?.estado).toBe("resuelta");
    expect(resumen(await salidaDe((alarma as FilaAlarma).id))).toEqual([
      "abierta:ana",
      "abierta:beto",
      "resuelta:ana",
      "resuelta:beto",
    ]);
  });

  it("una alarma de nivel y una de sensor conviven en el mismo nodo", async () => {
    const nodo = nodoN(12);
    await aplicar([estado(nodo, "critica", T0, { confianza: "revisar" })]);
    const alarmas = await alarmasDe(nodo);
    expect(alarmas.map((a) => a.tipo).sort()).toEqual(["nivel", "sensor"]);
    const abiertas = await conSistema(bd, (tx) =>
      tx.execute<{ n: string }>(
        sql`SELECT count(*)::text AS n FROM app.alarmas WHERE nodo_id = ${nodo}::uuid AND estado <> 'resuelta'`,
      ),
    );
    expect(abiertas.rows[0]?.n).toBe("2");
  });
});
