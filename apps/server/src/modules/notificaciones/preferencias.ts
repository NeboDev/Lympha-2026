import type { PreferenciaNotificacion, SeveridadAlarma } from "@lympha/contracts";
import { sql } from "drizzle-orm";
import type { Tx } from "../../platform/db.ts";

/** Preferencias de aviso del usuario en sesión (RF-31). Todo va por `conUsuario()`: la RLS limita a las propias. */

export const PREFERENCIA_POR_DEFECTO: Omit<PreferenciaNotificacion, "nodo_id"> = {
  niveles: ["mala", "critica"],
  silencio_inicio: null,
  silencio_fin: null,
  zona_horaria: "America/Mexico_City",
  recordatorio_h: 6,
};

interface Fila extends Record<string, unknown> {
  nodo_id: string | null;
  niveles: string[];
  silencio_inicio: string | null;
  silencio_fin: string | null;
  zona_horaria: string;
  recordatorio_h: number;
}

const aPreferencia = (f: Fila): PreferenciaNotificacion => ({
  nodo_id: f.nodo_id,
  niveles: f.niveles as SeveridadAlarma[],
  // `time` llega como HH:MM:SS
  silencio_inicio: f.silencio_inicio?.slice(0, 5) ?? null,
  silencio_fin: f.silencio_fin?.slice(0, 5) ?? null,
  zona_horaria: f.zona_horaria,
  recordatorio_h: f.recordatorio_h,
});

export async function leerPreferencias(
  tx: Tx,
): Promise<{ defecto: PreferenciaNotificacion; nodos: PreferenciaNotificacion[] }> {
  const r = await tx.execute<Fila>(sql`
    SELECT nodo_id, niveles::text[] AS niveles, silencio_inicio::text AS silencio_inicio,
           silencio_fin::text AS silencio_fin, zona_horaria, recordatorio_h
    FROM app.preferencias_notificacion
    WHERE usuario_id = app.usuario_actual()
    ORDER BY nodo_id NULLS FIRST`);
  const todas = r.rows.map(aPreferencia);
  return {
    defecto: todas.find((p) => p.nodo_id === null) ?? { nodo_id: null, ...PREFERENCIA_POR_DEFECTO },
    nodos: todas.filter((p) => p.nodo_id !== null),
  };
}

/** ¿Ve el usuario este nodo? (RLS: solo los de sus espacios). Un nodo ajeno e inexistente son indistinguibles. */
export async function nodoVisible(tx: Tx, nodoId: string): Promise<boolean> {
  const r = await tx.execute(sql`SELECT 1 FROM app.nodos WHERE id = ${nodoId}::uuid`);
  return r.rows.length > 0;
}

export async function guardarPreferencia(tx: Tx, p: PreferenciaNotificacion): Promise<void> {
  // Drizzle expande los arreglos de JS en varios parámetros: los niveles viajan como un solo literal de Postgres.
  const niveles = `{${p.niveles.join(",")}}`;
  await tx.execute(sql`
    INSERT INTO app.preferencias_notificacion
      (usuario_id, nodo_id, niveles, silencio_inicio, silencio_fin, zona_horaria, recordatorio_h)
    VALUES (app.usuario_actual(), ${p.nodo_id}::uuid, ${niveles}::app.nivel[], ${p.silencio_inicio}::time,
            ${p.silencio_fin}::time, ${p.zona_horaria}, ${p.recordatorio_h})
    ON CONFLICT (usuario_id, nodo_id) DO UPDATE SET
      niveles = EXCLUDED.niveles, silencio_inicio = EXCLUDED.silencio_inicio,
      silencio_fin = EXCLUDED.silencio_fin, zona_horaria = EXCLUDED.zona_horaria,
      recordatorio_h = EXCLUDED.recordatorio_h`);
}

export async function borrarPreferenciaDeNodo(tx: Tx, nodoId: string): Promise<void> {
  await tx.execute(sql`
    DELETE FROM app.preferencias_notificacion
    WHERE usuario_id = app.usuario_actual() AND nodo_id = ${nodoId}::uuid`);
}
