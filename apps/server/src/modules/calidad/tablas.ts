import { jsonb, numeric, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = pgSchema("ts");

/** `ts.evaluaciones`: una fila por lectura evaluada (nivel confirmado, WQI y versión del algoritmo). */
export const evaluaciones = ts.table("evaluaciones", {
  nodoId: uuid("nodo_id").notNull(),
  espacioId: uuid("espacio_id").notNull(),
  ts: timestamp("ts", { withTimezone: true, mode: "date" }).notNull(),
  wqi: numeric("wqi", { precision: 5, scale: 2, mode: "number" }),
  nivel: text("nivel").notNull(),
  parametroLimitante: text("parametro_limitante"),
  confianza: text("confianza").notNull(),
  versionAlgoritmo: text("version_algoritmo").notNull(),
  subindices: jsonb("subindices").notNull(),
});
