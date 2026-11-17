import { parseArgs } from "node:util";
import { cargarConfig } from "../config.ts";
import { tokenDeEmulador } from "../plataforma/firebase.ts";

// Herramienta de desarrollo: fabrica un token con la forma de los del emulador de Auth para probar
// la API sin iniciar sesión con Google. Solo lo acepta un servidor con FIREBASE_USE_EMULATOR=true
// (que la configuración solo permite con APP_ENV=local); con Firebase real, un token sin firma se rechaza.
const AYUDA = `Uso:
  pnpm dev:token <correo> [--nombre "Ana"] [--uid mi-uid]
      Imprime un token válido una hora para ese correo. Úsalo así:
        curl -H "Authorization: Bearer <token>" http://127.0.0.1:3100/api/yo
      El servidor debe correr con FIREBASE_USE_EMULATOR=true y el mismo FIREBASE_PROJECT_ID.`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { nombre: { type: "string" }, uid: { type: "string" } },
});
const correo = positionals[0];
if (!correo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
  console.log(AYUDA);
  process.exit(correo === undefined ? 0 : 2);
}

const config = cargarConfig(process.env);
if (!config.firebase) {
  console.error("Falta FIREBASE_PROJECT_ID en .env");
  process.exit(2);
}
if (!config.firebase.usarEmulador) {
  console.error(
    "Aviso: FIREBASE_USE_EMULATOR=false en este .env. El token se imprime igual, pero solo lo acepta un servidor con FIREBASE_USE_EMULATOR=true.",
  );
}
console.log(
  tokenDeEmulador({
    projectId: config.firebase.projectId,
    uid: values.uid ?? `dev-${correo.split("@")[0]}`,
    correo,
    ...(values.nombre ? { nombre: values.nombre } : {}),
  }),
);
