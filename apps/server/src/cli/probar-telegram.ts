// `pnpm dev:telegram [correo] [--historia nombre]`: recorrido de punta a punta con el bot REAL de desarrollo
// (@lympha_dev_bot) contra el Compose de desarrollo ya levantado (`pnpm dev`):
//
//   1. espera a la API y crea (o reutiliza) una cuenta en el emulador de Firebase Auth;
//   2. suma esa cuenta al espacio de desarrollo (donde vive el nodo de la semilla) para que reciba sus avisos;
//   3. te da el enlace de vinculación: lo abres en Telegram, pulsas «Iniciar» y el script lo detecta;
//   4. deja que avise de todos los niveles (regular, mala y crítica) para ver cada mensaje;
//   5. corre una historia del simulador (por defecto `turbidez_sube`: buena → regular → mala → crítica) y muestra,
//      conforme aparecen, los avisos de la bandeja de salida y si Telegram los aceptó.
//
// Solo APP_ENV=local. No lee `.env` ni muestra el token del bot: el token solo lo ven la API y el notifier.
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import pg from "pg";
import { DEV } from "../modules/fabrica/index.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    historia: { type: "string", default: "turbidez_sube" },
    "sin-simulador": { type: "boolean", default: false },
  },
});

const API = process.env.DEV_API_URL ?? "http://127.0.0.1:3000";
const correo = positionals[0] ?? "prueba@lympha.test";
const nodoId = process.env.DEV_NODO_ID;
const emulador = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const urlBd = process.env.DATABASE_URL_MIGRATE;

if (process.env.APP_ENV !== "local" || !nodoId || !emulador || !urlBd) {
  console.error(
    "Faltan variables de desarrollo: usa `pnpm dev:telegram` (carga dev.env y host.env).",
  );
  process.exit(1);
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
const paso = (n: number, texto: string) => console.log(`\n[${n}] ${texto}`);

async function esperar<T>(
  f: () => Promise<T | false | null | undefined>,
  ms: number,
): Promise<T | null> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    try {
      const r = await f();
      if (r) return r;
    } catch {
      // aún no está listo
    }
    await pausa(1500);
  }
  return null;
}

async function idToken(): Promise<string> {
  const base = `http://${emulador}/identitytoolkit.googleapis.com/v1/accounts`;
  const cred = { email: correo, password: "lympha-dev-1", returnSecureToken: true };
  const pedir = async (accion: string, cuerpo: object) => {
    const r = await fetch(`${base}:${accion}?key=emulador`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    return (await r.json()) as { idToken?: string; error?: { message?: string } };
  };
  let r = await pedir("signUp", { ...cred, displayName: correo.split("@")[0] });
  if (r.error?.message === "EMAIL_EXISTS") r = await pedir("signInWithPassword", cred);
  if (!r.idToken)
    throw new Error(`el emulador de Auth respondió: ${r.error?.message ?? "sin token"}`);
  return r.idToken;
}

paso(
  1,
  "Esperando a la API y al emulador de Firebase (si acabas de hacer `pnpm dev`, el primer arranque tarda unos minutos)…",
);
const listo = await esperar(async () => (await fetch(`${API}/health`)).ok, 5 * 60_000);
if (!listo) {
  console.error(
    "La API no responde en " +
      API +
      ". ¿Está corriendo `pnpm dev`? Revisa `docker compose logs api`.",
  );
  process.exit(1);
}
const token = await esperar(idToken, 60_000);
if (!token) {
  console.error("No se pudo obtener un token del emulador de Auth.");
  process.exit(1);
}
const llamar = async (metodo: string, ruta: string, cuerpo?: unknown) => {
  const r = await fetch(`${API}${ruta}`, {
    method: metodo,
    // Fastify rechaza un cuerpo vacío si el encabezado dice JSON: solo se manda cuando hay cuerpo.
    headers: {
      authorization: `Bearer ${token}`,
      ...(cuerpo !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
  });
  const texto = await r.text();
  return { status: r.status, cuerpo: texto ? (JSON.parse(texto) as Record<string, unknown>) : {} };
};

const yo = await llamar("GET", "/api/yo");
const usuarioId = yo.cuerpo.id as string;
console.log(`    Cuenta de prueba: ${correo}`);

const db = new pg.Client({ connectionString: urlBd });
await db.connect();
try {
  paso(2, "Sumando tu cuenta al espacio de desarrollo (donde vive el nodo de la semilla)…");
  await db.query(
    `INSERT INTO app.membresias (espacio_id, usuario_id, rol) VALUES ($1, $2, 'miembro')
     ON CONFLICT (espacio_id, usuario_id) DO NOTHING`,
    [DEV.espacioId, usuarioId],
  );

  paso(3, "Vinculación de Telegram");
  let estado = await llamar("GET", "/api/yo/telegram");
  if (estado.cuerpo.vinculado) {
    console.log(
      "    Ya estaba vinculada. (Para vincular otro chat: /desvincular en el bot y vuelve a correr esto.)",
    );
  } else {
    const v = await llamar("POST", "/api/yo/telegram/vinculo");
    if (v.status === 503) {
      console.error(
        "    El bot no está disponible: falta TELEGRAM_BOT_TOKEN en .env, o Telegram no lo reconoce.\n" +
          "    Ponlo en .env (carpeta raíz del repo) y reinicia `pnpm dev` para que la API y el notifier lo lean.",
      );
      process.exit(1);
    }
    if (v.status !== 201) {
      console.error(`    La API respondió ${v.status}: ${JSON.stringify(v.cuerpo)}`);
      process.exit(1);
    }
    console.log(
      `\n    Abre este enlace en Telegram y pulsa «Iniciar» (vale 10 minutos):\n\n        ${v.cuerpo.enlace}\n`,
    );
    const ok = await esperar(async () => {
      estado = await llamar("GET", "/api/yo/telegram");
      return estado.cuerpo.vinculado === true;
    }, 10 * 60_000);
    if (!ok) {
      console.error("    No se detectó la vinculación a tiempo.");
      process.exit(1);
    }
    console.log("    ✔ Vinculada: el bot debe haberte respondido «quedó vinculado».");
  }

  paso(4, "Preferencias: avisar de todos los niveles para ver cada mensaje");
  await llamar("PUT", "/api/yo/notificaciones", {
    nodo_id: null,
    niveles: ["regular", "mala", "critica"],
    silencio_inicio: null,
    silencio_fin: null,
    zona_horaria: "America/Mexico_City",
    recordatorio_h: 6,
  });

  if (values["sin-simulador"]) {
    console.log(
      "\nListo (sin simulador). Ejecuta `pnpm simulator --historia turbidez_sube --intervalo 1` cuando quieras.",
    );
    process.exit(0);
  }

  const previas = await db.query("SELECT count(*)::int AS n FROM app.alarmas WHERE nodo_id = $1", [
    nodoId,
  ]);
  if ((previas.rows[0]?.n as number) > 0) {
    console.log(
      "    Aviso: el nodo de desarrollo ya tiene alarmas de una corrida anterior; el motor recuerda su nivel.\n" +
        "    Para empezar de cero: `docker compose -f infra/compose/base.yml -f infra/compose/dev.yml down -v` y `pnpm dev`.",
    );
  }

  paso(
    5,
    `Simulador: historia «${values.historia}» (una lectura por segundo; tarda un par de minutos)`,
  );
  const inicio = new Date();
  const sim = spawn(
    process.execPath,
    [
      "--env-file=infra/compose/dev.env",
      "tools/simulator/src/cli.ts",
      "--url",
      "mqtts://localhost:8883",
      "--ca",
      "infra/certs/ca.crt",
      "--historia",
      values.historia as string,
      "--intervalo",
      "1",
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  let simTerminado = false;
  let codigoSim = 0;
  sim.on("exit", (c) => {
    simTerminado = true;
    codigoSim = c ?? 0;
  });

  const vistos = new Map<string, string>();
  let ultimoCambio = Date.now();
  const limite = Date.now() + 6 * 60_000;
  while (Date.now() < limite) {
    const filas = await db.query(
      `SELECT id, evento, estado, intentos, split_part(payload->>'texto', E'\\n', 1) AS titulo,
              split_part(payload->>'texto', E'\\n', 2) AS detalle
       FROM app.notificaciones_salida
       WHERE payload->>'nodo_id' = $1 AND usuario_id = $2 AND creado_en >= $3 ORDER BY creado_en, id`,
      [nodoId, usuarioId, inicio],
    );
    for (const f of filas.rows) {
      const marca = `${f.estado}/${f.intentos}`;
      if (vistos.get(f.id) === marca) continue;
      vistos.set(f.id, marca);
      ultimoCambio = Date.now();
      const icono =
        f.estado === "enviada"
          ? "✔ enviado "
          : f.estado === "pendiente"
            ? "… pendiente"
            : `✖ ${f.estado}`;
      console.log(`    ${icono}  ${String(f.evento).padEnd(12)} ${f.titulo} — ${f.detalle}`);
    }
    const hayPendientes = filas.rows.some((f) => f.estado === "pendiente");
    if (simTerminado && !hayPendientes && Date.now() - ultimoCambio > 8000) break;
    await pausa(1500);
  }

  const total = [...vistos.values()];
  const enviados = total.filter((m) => m.startsWith("enviada")).length;
  console.log(
    `\nResumen: ${enviados} de ${total.length} avisos enviados a Telegram. Simulador ${codigoSim === 0 ? "terminó bien" : `terminó con código ${codigoSim}`}.`,
  );
  console.log("Revisa tu chat con el bot: debes ver los mismos mensajes, en el mismo orden.");
  if (total.length === 0) {
    console.log(
      "No hubo avisos: revisa `docker compose logs worker notifier` y que el simulador pudo conectarse (infra/certs/ca.crt).",
    );
  }
} finally {
  await db.end();
}
