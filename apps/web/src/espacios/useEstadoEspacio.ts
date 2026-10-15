import { eventoConexion, eventoEstado, eventoSnapshot } from "@lympha/contracts";
import { useEffect, useMemo, useState } from "react";
import { useEspacio } from "../api/consultas.ts";
import { useApi } from "../api/contexto.ts";
import { type EstadoFlujo, type MensajeSse, mantenerFlujo } from "../api/sse.ts";
import {
  combinar,
  conConexion,
  conEstado,
  conSnapshot,
  type DatosSse,
  sseVacio,
} from "./estado.ts";

/**
 * Los nodos de un espacio con su semáforo en vivo (RF-22, RF-24): la API REST da nombres y estado inicial y el
 * stream SSE los mantiene al día sin recargar. Al volver a conectar, el `snapshot` corrige lo que se perdió.
 */
export function useEstadoEspacio(espacioId: string) {
  const api = useApi();
  const detalle = useEspacio(espacioId);
  const [sse, setSse] = useState<DatosSse>(sseVacio);
  const [flujo, setFlujo] = useState<EstadoFlujo>("conectando");

  useEffect(() => {
    if (espacioId === "") return; // sin espacio no hay stream
    const control = new AbortController();
    setSse(sseVacio);

    const alMensaje = (m: MensajeSse) => {
      let dato: unknown;
      try {
        dato = JSON.parse(m.datos);
      } catch {
        return; // un mensaje ilegible no debe tumbar la pantalla
      }
      const ahora = Date.now();
      if (m.evento === "snapshot") {
        const r = eventoSnapshot.safeParse(dato);
        if (r.success) setSse(conSnapshot(r.data, ahora));
      } else if (m.evento === "estado") {
        const r = eventoEstado.safeParse(dato);
        if (r.success) setSse((previo) => conEstado(previo, r.data, ahora));
      } else if (m.evento === "conexion") {
        const r = eventoConexion.safeParse(dato);
        if (r.success) setSse((previo) => conConexion(previo, r.data, ahora));
      }
      // `alarma`: las alertas llegan en otro paso
    };

    void mantenerFlujo({
      signal: control.signal,
      abrir: (signal) => api.abrirFlujo(`/api/espacios/${espacioId}/eventos`, signal),
      alMensaje,
      alEstado: setFlujo,
    });
    return () => control.abort();
  }, [api, espacioId]);

  const nodos = useMemo(
    () => combinar(detalle.data?.nodos ?? [], sse, detalle.dataUpdatedAt),
    [detalle.data, detalle.dataUpdatedAt, sse],
  );

  return { detalle, nodos, flujo };
}

/** Reloj que se actualiza cada 30 s, para que «hace 5 min» no se quede congelado. */
export function useAhora(): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return ahora;
}
