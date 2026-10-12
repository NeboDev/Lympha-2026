import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type BdApp,
  type BdSistema,
  conSistema,
  conUsuario,
  crearBdApp,
  crearBdSistema,
} from "../src/platform/db.ts";
import { migrar } from "../src/platform/migrar.ts";
import { iniciarPostgres, type PostgresDePrueba } from "./helpers/contenedores.ts";
import { falla } from "./helpers/errores.ts";

const PEPPER = "pepper-de-prueba";

// Dos clientes, cada uno con su espacio y su nodo. Ids fijos para legibilidad.
const ID = {
  ana: "0192f3a7-0000-7000-8000-00000000a001",
  beto: "0192f3a7-0000-7000-8000-00000000b001",
  espacioAna: "0192f3a7-0000-7000-8000-00000000a0e1",
  espacioBeto: "0192f3a7-0000-7000-8000-00000000b0e1",
  nodoAna: "0192f3a7-0000-7000-8000-00000000a0d1",
  nodoBeto: "0192f3a7-0000-7000-8000-00000000b0d1",
  nodoLibre: "0192f3a7-0000-7000-8000-00000000c0d1",
  lote: "0192f3a7-0000-7000-8000-0000000000f1",
};

let pgc: PostgresDePrueba;
let bdApp: BdApp;
let bdSistema: BdSistema;
let owner: pg.Client;

beforeAll(async () => {
  pgc = await iniciarPostgres();
  await migrar(pgc.url("owner"));

  owner = new pg.Client({ connectionString: pgc.url("owner") });
  await owner.connect();
  await owner.query(
    `INSERT INTO app.usuarios (id, auth_uid, email, nombre) VALUES
       ('${ID.ana}', 'uid-ana', 'ana@example.com', 'Ana'),
       ('${ID.beto}', 'uid-beto', 'beto@example.com', 'Beto');
     INSERT INTO app.espacios (id, nombre, tipo) VALUES
       ('${ID.espacioAna}', 'Casa de Ana', 'hogar'),
       ('${ID.espacioBeto}', 'Casa de Beto', 'hogar');
     INSERT INTO app.membresias (espacio_id, usuario_id, rol) VALUES
       ('${ID.espacioAna}', '${ID.ana}', 'propietario'),
       ('${ID.espacioBeto}', '${ID.beto}', 'propietario');
     INSERT INTO app.lotes (id, cantidad, version_hw) VALUES ('${ID.lote}', 3, 'v1');
     INSERT INTO app.nodos (id, lote_id, espacio_id, estado, claim_hash) VALUES
       ('${ID.nodoAna}', '${ID.lote}', '${ID.espacioAna}', 'activo', '\\x00'),
       ('${ID.nodoBeto}', '${ID.lote}', '${ID.espacioBeto}', 'activo', '\\x00');
     INSERT INTO app.nodos (id, lote_id, estado, claim_hash)
       VALUES ('${ID.nodoLibre}', '${ID.lote}', 'fabricado',
               digest('CODIGO-OK' || '${PEPPER}', 'sha256'));
     INSERT INTO app.estado_nodo (nodo_id, espacio_id) VALUES
       ('${ID.nodoAna}', '${ID.espacioAna}'), ('${ID.nodoBeto}', '${ID.espacioBeto}');`,
  );

  bdApp = crearBdApp(pgc.url("app"), 5);
  bdSistema = crearBdSistema(pgc.url("system"), "prueba", 5);

  await conSistema(bdSistema, async (tx) => {
    await tx.execute(sql`
      INSERT INTO ts.lecturas (nodo_id, espacio_id, ts, seq, ph) VALUES
        (${ID.nodoAna}, ${ID.espacioAna}, now() - interval '2 minutes', 1, 7.1),
        (${ID.nodoAna}, ${ID.espacioAna}, now() - interval '1 minute', 2, 7.2),
        (${ID.nodoBeto}, ${ID.espacioBeto}, now() - interval '1 minute', 1, 6.5)`);
  });
});

afterAll(async () => {
  await bdApp?.cerrar();
  await bdSistema?.cerrar();
  await owner?.end();
  await pgc?.detener();
});

const filas = <T>(r: { rows: unknown[] }) => r.rows as T[];

describe("migraciones", () => {
  it("son idempotentes: una segunda corrida no aplica nada", async () => {
    const r = await migrar(pgc.url("owner"));
    expect(r.aplicadas).toEqual([]);
    expect(r.yaAplicadas.length).toBeGreaterThanOrEqual(10);
  });

  it("uuid_v7 genera UUIDs versión 7 ordenados por tiempo", async () => {
    const r = await owner.query<{ a: string; b: string }>(
      "SELECT app.uuid_v7()::text a, (SELECT app.uuid_v7()::text FROM pg_sleep(0.01)) b",
    );
    const { a, b } = r.rows[0] as { a: string; b: string };
    expect(a[14]).toBe("7");
    expect(a < b).toBe(true);
  });

  it("deja las tablas con espacio_id bajo RLS forzado", async () => {
    const r = await owner.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'app' AND relkind = 'r'
         AND relname IN ('espacios','membresias','invitaciones','nodos','estado_nodo','alarmas',
                         'calibraciones','eventos_usuario','usuarios','vinculos_telegram',
                         'preferencias_notificacion')`,
    );
    expect(r.rows).toHaveLength(11);
    for (const t of r.rows) {
      expect(t.relrowsecurity, t.relname).toBe(true);
      expect(t.relforcerowsecurity, t.relname).toBe(true);
    }
  });
});

describe("aislamiento por conUsuario()", () => {
  it("cada usuario ve solo su espacio y su nodo", async () => {
    const ana = await conUsuario(bdApp, ID.ana, async (tx) => ({
      espacios: filas<{ id: string }>(await tx.execute(sql`SELECT id FROM app.espacios`)),
      nodos: filas<{ id: string }>(await tx.execute(sql`SELECT id FROM app.nodos`)),
      usuarios: filas<{ id: string }>(await tx.execute(sql`SELECT id FROM app.usuarios`)),
    }));
    expect(ana.espacios.map((e) => e.id)).toEqual([ID.espacioAna]);
    expect(ana.nodos.map((n) => n.id)).toEqual([ID.nodoAna]);
    expect(ana.usuarios.map((u) => u.id)).toEqual([ID.ana]);
  });

  it("las lecturas se leen solo por app.v_lecturas y solo las del propio espacio", async () => {
    const ana = await conUsuario(bdApp, ID.ana, async (tx) =>
      filas<{ nodo_id: string }>(await tx.execute(sql`SELECT nodo_id FROM app.v_lecturas`)),
    );
    expect(ana).toHaveLength(2);
    expect(new Set(ana.map((l) => l.nodo_id))).toEqual(new Set([ID.nodoAna]));
  });

  it("pedir explícitamente el nodo de otro espacio devuelve 0 filas", async () => {
    const r = await conUsuario(bdApp, ID.ana, async (tx) =>
      filas<unknown>(
        await tx.execute(sql`SELECT * FROM app.v_lecturas WHERE nodo_id = ${ID.nodoBeto}`),
      ),
    );
    expect(r).toEqual([]);
  });

  it("la API no puede leer ts.* directamente", async () => {
    expect(
      await falla(conUsuario(bdApp, ID.ana, (tx) => tx.execute(sql`SELECT * FROM ts.lecturas`))),
    ).toMatch(/permission denied/i);
  });

  it("sin usuario fijado no se ve nada", async () => {
    const cliente = new pg.Client({ connectionString: pgc.url("app") });
    await cliente.connect();
    try {
      expect((await cliente.query("SELECT 1 FROM app.espacios")).rowCount).toBe(0);
      expect((await cliente.query("SELECT 1 FROM app.v_lecturas")).rowCount).toBe(0);
    } finally {
      await cliente.end();
    }
  });

  it("el contexto no se filtra entre transacciones del mismo pool", async () => {
    await conUsuario(bdApp, ID.ana, async (tx) => {
      await tx.execute(sql`SELECT 1`);
    });
    const cliente = await bdApp.pool.connect();
    try {
      const r = await cliente.query("SELECT current_setting('app.usuario_id', true) AS u");
      expect(r.rows[0].u === "" || r.rows[0].u === null).toBe(true);
    } finally {
      cliente.release();
    }
  });

  it("un usuario no puede modificar el nodo de otro (0 filas) ni insertar membresías", async () => {
    const n = await conUsuario(
      bdApp,
      ID.ana,
      async (tx) =>
        (await tx.execute(sql`UPDATE app.nodos SET nombre = 'hackeado' WHERE id = ${ID.nodoBeto}`))
          .rowCount,
    );
    expect(n).toBe(0);
    expect(
      await falla(
        conUsuario(bdApp, ID.ana, (tx) =>
          tx.execute(
            sql`INSERT INTO app.membresias (espacio_id, usuario_id, rol)
              VALUES (${ID.espacioBeto}, ${ID.ana}, 'miembro')`,
          ),
        ),
      ),
    ).toMatch(/permission denied/i);
    const r = await owner.query("SELECT nombre FROM app.nodos WHERE id = $1", [ID.nodoBeto]);
    expect(r.rows[0].nombre).toBeNull();
  });

  it("rechaza un usuarioId que no sea UUID antes de tocar la base", async () => {
    await expect(conUsuario(bdApp, "1; DROP TABLE x", async () => 1)).rejects.toThrow(TypeError);
  });
});

describe("reclamar_nodo", () => {
  it("rechaza al que no es propietario del espacio", async () => {
    const motivo = await falla(
      conUsuario(
        bdApp,
        ID.ana,
        (tx) =>
          tx.execute(
            sql`SELECT app.reclamar_nodo(${ID.nodoLibre}::uuid, 'CODIGO-OK', ${ID.espacioBeto}::uuid, 'cisterna')`,
          ),
        { claimPepper: PEPPER },
      ),
    );
    expect(motivo).toMatch(/no_autorizado/);
  });

  it("rechaza un código incorrecto con el mismo error que un nodo inexistente", async () => {
    for (const [nodo, codigo] of [
      [ID.nodoLibre, "MAL"],
      ["0192f3a7-0000-7000-8000-0000000000ff", "CODIGO-OK"],
    ] as const) {
      expect(
        await falla(
          conUsuario(
            bdApp,
            ID.ana,
            (tx) =>
              tx.execute(
                sql`SELECT app.reclamar_nodo(${nodo}::uuid, ${codigo}, ${ID.espacioAna}::uuid, 'cisterna')`,
              ),
            { claimPepper: PEPPER },
          ),
        ),
      ).toMatch(/reclamo_invalido/);
    }
  });

  it("reclama el nodo con el código correcto y deja auditoría", async () => {
    await conUsuario(
      bdApp,
      ID.ana,
      (tx) =>
        tx.execute(
          sql`SELECT app.reclamar_nodo(${ID.nodoLibre}::uuid, 'CODIGO-OK', ${ID.espacioAna}::uuid, 'cisterna')`,
        ),
      { claimPepper: PEPPER },
    );
    const nodos = await conUsuario(bdApp, ID.ana, async (tx) =>
      filas<{ id: string }>(await tx.execute(sql`SELECT id FROM app.nodos ORDER BY id`)),
    );
    expect(nodos.map((n) => n.id)).toContain(ID.nodoLibre);
    const aud = await owner.query("SELECT accion FROM app.auditoria WHERE nodo_id = $1", [
      ID.nodoLibre,
    ]);
    expect(aud.rows).toEqual([{ accion: "nodo.reclamado" }]);
    // Beto sigue sin verlo
    const beto = await conUsuario(bdApp, ID.beto, async (tx) =>
      filas<{ id: string }>(await tx.execute(sql`SELECT id FROM app.nodos`)),
    );
    expect(beto.map((n) => n.id)).not.toContain(ID.nodoLibre);
  });
});

describe("conSistema()", () => {
  it("la inserción de lecturas es idempotente por (nodo_id, ts)", async () => {
    const ts = "2026-10-11T12:00:00Z";
    const insertar = () =>
      conSistema(
        bdSistema,
        async (tx) =>
          (
            await tx.execute(sql`
            INSERT INTO ts.lecturas (nodo_id, espacio_id, ts, seq, ph)
            VALUES (${ID.nodoAna}, ${ID.espacioAna}, ${ts}, 99, 7.0)
            ON CONFLICT (nodo_id, ts) DO NOTHING`)
          ).rowCount,
      );
    expect(await insertar()).toBe(1);
    expect(await insertar()).toBe(0);
  });

  it("solo tiene los permisos concedidos: no lee usuarios ni crea espacios", async () => {
    expect(
      await falla(conSistema(bdSistema, (tx) => tx.execute(sql`SELECT * FROM app.usuarios`))),
    ).toMatch(/permission denied/i);
    expect(
      await falla(
        conSistema(bdSistema, (tx) =>
          tx.execute(sql`INSERT INTO app.espacios (nombre, tipo) VALUES ('x', 'hogar')`),
        ),
      ),
    ).toMatch(/permission denied/i);
  });
});
