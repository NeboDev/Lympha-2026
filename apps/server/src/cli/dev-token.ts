// `pnpm dev:token [correo] [--nombre "Ana"]`: crea (o reutiliza) una cuenta en el emulador de Firebase Auth y
// imprime un ID token válido para la API local:
//
//   curl -H "Authorization: Bearer $(pnpm -s dev:token ana@example.com)" http://127.0.0.1:3000/api/yo
//
// Solo APP_ENV=local y solo contra el emulador (FIREBASE_AUTH_EMULATOR_HOST); no toca ningún proyecto real.
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { nombre: { type: "string" } },
});

if (process.env.APP_ENV !== "local") {
  console.error("dev:token solo funciona con APP_ENV=local");
  process.exit(1);
}
const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!host) {
  console.error(
    "Falta FIREBASE_AUTH_EMULATOR_HOST (el emulador de Auth del Compose de desarrollo escucha en 127.0.0.1:9099).",
  );
  process.exit(1);
}

const correo = positionals[0] ?? "dev@lympha.test";
const credenciales = { email: correo, password: "lympha-dev-1", returnSecureToken: true };
const base = `http://${host}/identitytoolkit.googleapis.com/v1/accounts`;

async function pedir(accion: "signUp" | "signInWithPassword", cuerpo: object) {
  const r = await fetch(`${base}:${accion}?key=emulador`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  return { ok: r.ok, json: (await r.json()) as { idToken?: string; error?: { message?: string } } };
}

try {
  let r = await pedir("signUp", {
    ...credenciales,
    displayName: values.nombre ?? correo.split("@")[0],
  });
  if (!r.ok && r.json.error?.message === "EMAIL_EXISTS")
    r = await pedir("signInWithPassword", credenciales);
  if (!r.ok || !r.json.idToken) {
    console.error(`El emulador respondió: ${r.json.error?.message ?? "error desconocido"}`);
    process.exit(1);
  }
  process.stdout.write(`${r.json.idToken}\n`);
} catch {
  console.error(
    `No se pudo conectar con el emulador de Auth en ${host}. ¿Está levantado? (pnpm dev)`,
  );
  process.exit(1);
}
