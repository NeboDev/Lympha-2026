// Genera los JSON Schema del contrato MQTT que se copian al firmware (`lympha-firmware`).
//   pnpm --filter @lympha/contracts schemas
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { esquemasMqtt } from "../src/json-schema.ts";

const salida = join(import.meta.dirname, "..", "schemas");
mkdirSync(salida, { recursive: true });
for (const [nombre, esquema] of Object.entries(esquemasMqtt)) {
  const json = zodToJsonSchema(esquema, { target: "jsonSchema7", $refStrategy: "none" });
  writeFileSync(join(salida, `${nombre}.json`), `${JSON.stringify(json, null, 2)}\n`);
}
console.log(`JSON Schema escritos en ${salida}`);
