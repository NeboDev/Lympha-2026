import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BdSistema, conSistema, crearBdSistema } from "../src/platform/db.ts";
import { migrar } from "../src/platform/migrar.ts";
import { iniciarPostgres, type PostgresDePrueba } from "./helpers/contenedores.ts";

/**
 * H3: alarmas, bandeja de salida y notifier. Esta primera parte cubre las funciones SQL de la migración
 * `0012` (preferencias de aviso y horario silencioso).
 */

const ID = {
  ana: "0192f3a7-0000-7000-8000-00000000a001",
  espacio: "0192f3a7-0000-7000-8000-00000000a0e1",
  nodo: "0192f3a7-0000-7000-8000-00000000a0d1",
  otroNodo: "0192f3a7-0000-7000-8000-00000000a0d2",
  lote: "0192f3a7-0000-7000-8000-0000000000f1",
};

let pgc: PostgresDePrueba;
let owner: pg.Client;
let bdSistema: BdSistema;

beforeAll(async () => {
  pgc = await iniciarPostgres();
  await migrar(pgc.url("owner"));
  owner = new pg.Client({ connectionString: pgc.url("owner") });
  await owner.connect();
  await owner.query(
    `INSERT INTO app.usuarios (id, auth_uid, email, nombre) VALUES ('${ID.ana}', 'uid-ana', 'ana@example.com', 'Ana');
     INSERT INTO app.espacios (id, nombre, tipo) VALUES ('${ID.espacio}', 'Casa', 'hogar');
     INSERT INTO app.membresias (espacio_id, usuario_id, rol) VALUES ('${ID.espacio}', '${ID.ana}', 'propietario');
     INSERT INTO app.lotes (id, cantidad, version_hw) VALUES ('${ID.lote}', 2, 'v1');
     INSERT INTO app.nodos (id, lote_id, espacio_id, estado, claim_hash) VALUES
       ('${ID.nodo}', '${ID.lote}', '${ID.espacio}', 'activo', '\\x00'),
       ('${ID.otroNodo}', '${ID.lote}', '${ID.espacio}', 'activo', '\\x00');`,
  );
  bdSistema = crearBdSistema(pgc.url("system"), "prueba", 5);
});

afterAll(async () => {
  await bdSistema?.cerrar();
  await owner?.end();
  await pgc?.detener();
});

const limpiarPreferencias = () => owner.query("DELETE FROM app.preferencias_notificacion");

async function quiere(nodo: string, niveles: string[] | null): Promise<boolean> {
  // Drizzle expande un arreglo de JS en varios parámetros; Postgres lo recibe como un solo literal.
  const arreglo =
    niveles === null ? sql`NULL::app.nivel[]` : sql`${`{${niveles.join(",")}}`}::app.nivel[]`;
  const r = await conSistema(bdSistema, (tx) =>
    tx.execute<{ q: boolean }>(
      sql`SELECT app.quiere_aviso(${ID.ana}::uuid, ${nodo}::uuid, ${arreglo}) AS q`,
    ),
  );
  return r.rows[0]?.q === true;
}

async function envio(nodo: string, ahoraIso: string): Promise<string> {
  const r = await conSistema(bdSistema, (tx) =>
    tx.execute<{ t: Date }>(
      sql`SELECT app.siguiente_envio(${ID.ana}::uuid, ${nodo}::uuid, ${ahoraIso}::timestamptz) AS t`,
    ),
  );
  return new Date((r.rows[0] as { t: Date }).t).toISOString();
}

describe("migración 0012: preferencias de aviso", () => {
  it("quiere_aviso: sin preferencias avisa de mala y crítica; el aviso de otro tipo siempre pasa", async () => {
    await limpiarPreferencias();
    expect(await quiere(ID.nodo, ["regular"])).toBe(false);
    expect(await quiere(ID.nodo, ["mala"])).toBe(true);
    expect(await quiere(ID.nodo, ["critica"])).toBe(true);
    // una mejora de crítica a regular se avisa porque el nivel anterior sí estaba en la lista
    expect(await quiere(ID.nodo, ["regular", "critica"])).toBe(true);
    expect(await quiere(ID.nodo, null)).toBe(true);
  });

  it("quiere_aviso: la preferencia del usuario cambia los niveles y la del nodo manda sobre ella", async () => {
    await limpiarPreferencias();
    await owner.query(
      `INSERT INTO app.preferencias_notificacion (usuario_id, nodo_id, niveles)
       VALUES ('${ID.ana}', NULL, '{regular,mala,critica}'),
              ('${ID.ana}', '${ID.otroNodo}', '{critica}')`,
    );
    expect(await quiere(ID.nodo, ["regular"])).toBe(true);
    expect(await quiere(ID.otroNodo, ["regular"])).toBe(false);
    expect(await quiere(ID.otroNodo, ["mala"])).toBe(false);
    expect(await quiere(ID.otroNodo, ["critica"])).toBe(true);
    await limpiarPreferencias();
  });

  it("siguiente_envio: sin horario silencioso envía de inmediato", async () => {
    await limpiarPreferencias();
    expect(await envio(ID.nodo, "2026-10-14T06:30:00Z")).toBe("2026-10-14T06:30:00.000Z");
    await owner.query(
      `INSERT INTO app.preferencias_notificacion (usuario_id, nodo_id, niveles) VALUES ('${ID.ana}', NULL, '{mala}')`,
    );
    expect(await envio(ID.nodo, "2026-10-14T06:30:00Z")).toBe("2026-10-14T06:30:00.000Z");
    await limpiarPreferencias();
  });

  it("siguiente_envio: la ventana que cruza la medianoche difiere hasta su fin, en la zona del usuario", async () => {
    await limpiarPreferencias();
    await owner.query(
      `INSERT INTO app.preferencias_notificacion (usuario_id, nodo_id, silencio_inicio, silencio_fin, zona_horaria)
       VALUES ('${ID.ana}', NULL, '22:00', '07:00', 'America/Mexico_City')`,
    );
    // 21:00 en Ciudad de México (UTC-6): fuera de la ventana
    expect(await envio(ID.nodo, "2026-10-14T03:00:00Z")).toBe("2026-10-14T03:00:00.000Z");
    // 23:00 local: dentro; termina a las 07:00 local del día siguiente = 13:00 UTC
    expect(await envio(ID.nodo, "2026-10-14T05:00:00Z")).toBe("2026-10-14T13:00:00.000Z");
    // 00:30 local: dentro; termina a las 07:00 local de ese mismo día
    expect(await envio(ID.nodo, "2026-10-14T06:30:00Z")).toBe("2026-10-14T13:00:00.000Z");
    // 07:00 local en punto: la ventana ya terminó
    expect(await envio(ID.nodo, "2026-10-14T13:00:00Z")).toBe("2026-10-14T13:00:00.000Z");
    await limpiarPreferencias();
  });

  it("siguiente_envio: ventana dentro del mismo día y preferencia del nodo sobre la del usuario", async () => {
    await limpiarPreferencias();
    await owner.query(
      `INSERT INTO app.preferencias_notificacion (usuario_id, nodo_id, silencio_inicio, silencio_fin)
       VALUES ('${ID.ana}', NULL, '22:00', '07:00'),
              ('${ID.ana}', '${ID.otroNodo}', '13:00', '15:00')`,
    );
    // 08:00 local (14:00 UTC): fuera de la ventana propia de ese nodo (13:00–15:00 local)
    expect(await envio(ID.otroNodo, "2026-10-14T14:00:00Z")).toBe("2026-10-14T14:00:00.000Z");
    // 14:00 local = 20:00 UTC: dentro de 13:00–15:00, termina a las 15:00 local = 21:00 UTC
    expect(await envio(ID.otroNodo, "2026-10-14T20:00:00Z")).toBe("2026-10-14T21:00:00.000Z");
    // el otro nodo usa la del usuario (22:00–07:00): 14:00 local está fuera
    expect(await envio(ID.nodo, "2026-10-14T20:00:00Z")).toBe("2026-10-14T20:00:00.000Z");
    await limpiarPreferencias();
  });

  it("siguiente_envio: una zona horaria inválida no rompe la transacción y avisa de inmediato", async () => {
    await limpiarPreferencias();
    await owner.query(
      `INSERT INTO app.preferencias_notificacion (usuario_id, nodo_id, silencio_inicio, silencio_fin, zona_horaria)
       VALUES ('${ID.ana}', NULL, '22:00', '07:00', 'Marte/Olympus')`,
    );
    expect(await envio(ID.nodo, "2026-10-14T05:00:00Z")).toBe("2026-10-14T05:00:00.000Z");
    await limpiarPreferencias();
  });

  it("la bandeja acepta el evento 'mejorada' y rechaza uno desconocido", async () => {
    const insertar = (evento: string) =>
      owner.query(
        `INSERT INTO app.notificaciones_salida (espacio_id, usuario_id, evento, clave_idempotencia, payload)
         VALUES ('${ID.espacio}', '${ID.ana}', '${evento}', 'prueba-${evento}', '{}')`,
      );
    await insertar("mejorada");
    await expect(insertar("inventado")).rejects.toThrow(/notificaciones_salida_evento_check/);
    await owner.query("DELETE FROM app.notificaciones_salida");
  });
});
