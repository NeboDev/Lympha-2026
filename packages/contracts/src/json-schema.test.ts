import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import { esquemasMqtt } from "./json-schema.ts";

describe("JSON Schema del firmware", () => {
  for (const [nombre, esquema] of Object.entries(esquemasMqtt)) {
    it(`schemas/${nombre}.json está al día (pnpm --filter @lympha/contracts schemas)`, () => {
      const actual = JSON.parse(
        readFileSync(join(import.meta.dirname, "..", "schemas", `${nombre}.json`), "utf8"),
      );
      const esperado = zodToJsonSchema(esquema, { target: "jsonSchema7", $refStrategy: "none" });
      expect(actual).toEqual(JSON.parse(JSON.stringify(esperado)));
    });
  }
});
