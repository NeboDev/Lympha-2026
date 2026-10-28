import { integer, jsonb, pgSchema, real, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = pgSchema("ts");

export const lecturas = ts.table("lecturas", {
  nodoId: uuid("nodo_id").notNull(),
  espacioId: uuid("espacio_id").notNull(),
  ts: timestamp("ts", { withTimezone: true, mode: "date" }).notNull(),
  seq: integer("seq").notNull(),
  ph: real("ph"),
  temperatura: real("temperatura"),
  conductividad: real("conductividad"),
  turbidez: real("turbidez"),
  tds: real("tds"),
  crudo: jsonb("crudo").$type<Record<string, number>>(),
  recibidoEn: timestamp("recibido_en", { withTimezone: true, mode: "date" }).notNull(),
});
