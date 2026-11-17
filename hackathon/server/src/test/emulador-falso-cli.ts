import { iniciarEmuladorFalso } from "./emulador-falso.ts";

// Para la prueba manual de la API sin Docker: `node src/test/emulador-falso-cli.ts 9099`.
const e = await iniciarEmuladorFalso(Number(process.argv[2] ?? 9099));
console.log(`Emulador falso de Auth en ${e.host}`);
