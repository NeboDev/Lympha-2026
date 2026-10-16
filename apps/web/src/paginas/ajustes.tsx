import type { EspacioApi, PreferenciaNotificacion } from "@lympha/contracts";
import { useState } from "react";
import { FormularioPreferencia } from "../ajustes/FormularioPreferencia.tsx";
import { resumenPreferencia } from "../ajustes/preferencias.ts";
import { SeccionTelegram } from "../ajustes/SeccionTelegram.tsx";
import {
  useAccionesPreferencias,
  useEspacio,
  useEspacios,
  usePreferencias,
} from "../api/consultas.ts";
import { mensajeDeError } from "../api/mensajes.ts";

/** Los nodos de un espacio, cada uno con su preferencia propia o la general. */
function NodosDeEspacio({
  espacio,
  general,
  porNodo,
}: {
  espacio: EspacioApi;
  general: PreferenciaNotificacion;
  porNodo: PreferenciaNotificacion[];
}) {
  const detalle = useEspacio(espacio.id);
  const { guardar, quitarDeNodo } = useAccionesPreferencias();
  const [editando, setEditando] = useState<string | null>(null);

  const nodos = detalle.data?.nodos ?? [];
  if (detalle.data && nodos.length === 0) return null;

  return (
    <section className="grid gap-2" aria-label={`Nodos de ${espacio.nombre}`}>
      <h3 className="m-0">{espacio.nombre}</h3>
      <ul className="tarjetas tarjeta m-0 grid list-none gap-0 p-0">
        {nodos.map((n) => {
          const propia = porNodo.find((p) => p.nodo_id === n.id);
          const vigente = propia ?? general;
          return (
            <li
              key={n.id}
              className="preferencia-nodo flex flex-wrap items-start justify-between gap-3 border-b border-line p-4 last:border-b-0"
            >
              <div className="grid min-w-0 flex-1 gap-1">
                <strong>{n.nombre ?? "Nodo sin nombre"}</strong>
                <span className="text-sm text-text-2">
                  {propia ? "Personalizado: " : "Usa los ajustes generales: "}
                  {resumenPreferencia(vigente)}
                </span>
                {editando === n.id && (
                  <FormularioPreferencia
                    valor={{ ...vigente, nodo_id: n.id }}
                    nodoId={n.id}
                    textoGuardar="Guardar para este nodo"
                    ocupado={guardar.isPending}
                    errorDelServidor={guardar.isError ? mensajeDeError(guardar.error) : null}
                    alGuardar={(p) => guardar.mutate(p, { onSuccess: () => setEditando(null) })}
                    alCancelar={() => setEditando(null)}
                  />
                )}
              </div>
              {editando !== n.id && (
                <div className="acciones flex flex-wrap gap-1">
                  <button type="button" className="enlace" onClick={() => setEditando(n.id)}>
                    {propia ? "Editar" : "Personalizar"}
                  </button>
                  {propia && (
                    <button
                      type="button"
                      className="enlace"
                      disabled={quitarDeNodo.isPending}
                      onClick={() => quitarDeNodo.mutate(n.id)}
                    >
                      Usar los generales
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {quitarDeNodo.isError && <p role="alert">{mensajeDeError(quitarDeNodo.error)}</p>}
    </section>
  );
}

/** Ajustes de la persona: Telegram y qué avisos recibe (RF-26, RF-31). */
export function Ajustes() {
  const espacios = useEspacios();
  const preferencias = usePreferencias();
  const { guardar } = useAccionesPreferencias();
  const [guardado, setGuardado] = useState(false);

  return (
    <main className="pagina grid gap-6">
      <h1 className="m-0">Ajustes</h1>
      <SeccionTelegram />

      <section className="grid gap-4" aria-labelledby="h-avisos">
        <h2 id="h-avisos" className="m-0">
          Avisos
        </h2>
        {preferencias.isPending && (
          <p role="status" className="detalle m-0">
            Cargando…
          </p>
        )}
        {preferencias.isError && <p role="alert">{mensajeDeError(preferencias.error)}</p>}
        {preferencias.data && (
          <>
            <FormularioPreferencia
              valor={preferencias.data.defecto}
              nodoId={null}
              textoGuardar="Guardar ajustes generales"
              ocupado={guardar.isPending}
              errorDelServidor={guardar.isError ? mensajeDeError(guardar.error) : null}
              alGuardar={(p) => {
                setGuardado(false);
                guardar.mutate(p, { onSuccess: () => setGuardado(true) });
              }}
            />
            {guardado && !guardar.isPending && <p role="status">Ajustes guardados.</p>}

            <h2 className="m-0 mt-4">Por nodo</h2>
            <p className="detalle m-0">
              Cada nodo usa los ajustes generales hasta que lo personalices (por ejemplo, para
              avisar solo de lo crítico en un nodo).
            </p>
            {espacios.data?.espacios.map((e) => (
              <NodosDeEspacio
                key={e.id}
                espacio={e}
                general={preferencias.data.defecto}
                porNodo={preferencias.data.nodos}
              />
            ))}
          </>
        )}
      </section>
    </main>
  );
}
