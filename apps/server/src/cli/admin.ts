// Administradores de plataforma (panel de etiquetas y boyas). Es la ÚNICA forma de dar de alta o baja a uno:
// la API no puede escribir en app.admins_plataforma.
//
//   pnpm admin alta correo@ejemplo.com     # la persona debe haber iniciado sesión al menos una vez
//   pnpm admin baja correo@ejemplo.com
//   pnpm admin listar
import { parseArgs } from "node:util";
import pg from "pg";
import { cargarConfigOSalir } from "../platform/config.ts";

const { positionals } = parseArgs({ allowPositionals: true, args: process.argv.slice(2) });
const [comando, correo] = positionals;
const uso = "Uso: admin alta <correo> | admin baja <correo> | admin listar";

if (
  !comando ||
  !["alta", "baja", "listar"].includes(comando) ||
  (comando !== "listar" && !correo)
) {
  console.error(uso);
  process.exit(2);
}

const config = cargarConfigOSalir("admin");
const db = new pg.Client({ connectionString: config.DATABASE_URL_MIGRATE });

try {
  await db.connect();
  if (comando === "listar") {
    const r = await db.query<{ email: string; creado_en: Date }>(
      `SELECT u.email::text AS email, a.creado_en
       FROM app.admins_plataforma a JOIN app.usuarios u ON u.id = a.usuario_id ORDER BY a.creado_en`,
    );
    if (r.rowCount === 0) console.log("No hay administradores de plataforma.");
    for (const f of r.rows) console.log(`${f.email}  (desde ${f.creado_en.toISOString()})`);
  } else {
    const u = await db.query<{ id: string }>(
      "SELECT id FROM app.usuarios WHERE email = $1::citext",
      [correo],
    );
    const id = u.rows[0]?.id;
    if (!id) {
      console.error(
        "No existe un usuario con ese correo. Debe iniciar sesión en la app al menos una vez antes del alta.",
      );
      process.exit(1);
    }
    await db.query("BEGIN");
    if (comando === "alta") {
      const r = await db.query(
        "INSERT INTO app.admins_plataforma (usuario_id) VALUES ($1) ON CONFLICT DO NOTHING",
        [id],
      );
      if (r.rowCount) {
        await db.query(
          "INSERT INTO app.auditoria (actor_tipo, accion, detalle) VALUES ('fabrica', 'admin.alta', $1::jsonb)",
          [JSON.stringify({ usuario_id: id })],
        );
      }
      console.log(r.rowCount ? "Administrador dado de alta." : "Ya era administrador.");
    } else {
      const r = await db.query("DELETE FROM app.admins_plataforma WHERE usuario_id = $1", [id]);
      if (r.rowCount) {
        await db.query(
          "INSERT INTO app.auditoria (actor_tipo, accion, detalle) VALUES ('fabrica', 'admin.baja', $1::jsonb)",
          [JSON.stringify({ usuario_id: id })],
        );
      }
      console.log(r.rowCount ? "Administrador dado de baja." : "No era administrador.");
    }
    await db.query("COMMIT");
  }
} catch (error) {
  await db.query("ROLLBACK").catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.end().catch(() => undefined);
}
