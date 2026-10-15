import type { TipoEspacio } from "@lympha/contracts";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAccionesEspacio, useEspacio, useYo } from "../api/consultas.ts";
import { mensajeDeError } from "../api/mensajes.ts";
import {
  etiquetaEstadoNodo,
  etiquetaRol,
  etiquetaTipo,
  TIPOS_ESPACIO,
} from "../componentes/etiquetas.ts";

/** Detalle de un espacio: nodos, miembros, invitaciones y, para el propietario, edición y transferencia. */
export function Espacio() {
  const { espacioId = "" } = useParams();
  const navegar = useNavigate();
  const yo = useYo();
  const detalle = useEspacio(espacioId);
  const acciones = useAccionesEspacio();
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<TipoEspacio>("hogar");
  const [copiado, setCopiado] = useState(false);

  if (detalle.isPending) {
    return (
      <main className="pagina">
        <p role="status">Cargando…</p>
      </main>
    );
  }
  if (detalle.isError) {
    return (
      <main className="pagina">
        <p role="alert">{mensajeDeError(detalle.error)}</p>
        <Link to="/">Volver a tus espacios</Link>
      </main>
    );
  }

  const { espacio, miembros, nodos } = detalle.data;
  const soyPropietario = espacio.rol === "propietario";
  const miId = yo.data?.id;

  function guardar(evento: FormEvent) {
    evento.preventDefault();
    acciones.editar.mutate(
      { espacioId, nombre: nombre.trim(), tipo },
      { onSuccess: () => setEditando(false) },
    );
  }

  const enlaceInvitacion = acciones.invitar.data
    ? `${window.location.origin}/invitacion#${acciones.invitar.data.token}`
    : null;

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
    } catch {
      setCopiado(false); // sin permiso de portapapeles: la persona puede seleccionar el enlace
    }
  }

  return (
    <main className="pagina">
      <p>
        <Link to="/">← Tus espacios</Link>
      </p>

      {editando ? (
        <form onSubmit={guardar}>
          <label>
            Nombre
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={80}
              required
            />
          </label>
          <label>
            Tipo
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoEspacio)}>
              {TIPOS_ESPACIO.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.etiqueta}
                </option>
              ))}
            </select>
          </label>
          {acciones.editar.isError && <p role="alert">{mensajeDeError(acciones.editar.error)}</p>}
          <button type="submit" disabled={acciones.editar.isPending}>
            Guardar
          </button>
          <button type="button" className="secundario" onClick={() => setEditando(false)}>
            Cancelar
          </button>
        </form>
      ) : (
        <>
          <h1>{espacio.nombre}</h1>
          <p>
            {etiquetaTipo(espacio.tipo)} · {etiquetaRol(espacio.rol)}
          </p>
          {soyPropietario && (
            <button
              type="button"
              className="enlace"
              onClick={() => {
                setNombre(espacio.nombre);
                setTipo(espacio.tipo);
                setEditando(true);
              }}
            >
              Editar nombre y tipo
            </button>
          )}
        </>
      )}

      <h2>Nodos</h2>
      {nodos.length === 0 && <p>Todavía no hay nodos en este espacio.</p>}
      <ul className="tarjetas">
        {nodos.map((n) => (
          <li key={n.id}>
            <div>
              <strong>{n.nombre ?? "Nodo sin nombre"}</strong>
              <span>{etiquetaEstadoNodo(n)}</span>
            </div>
          </li>
        ))}
      </ul>
      {soyPropietario && <Link to={`/espacios/${espacioId}/reclamar`}>Reclamar un nodo</Link>}

      <h2>Miembros</h2>
      <ul className="tarjetas">
        {miembros.map((m) => {
          const esYo = m.usuario_id === miId;
          return (
            <li key={m.usuario_id}>
              <div>
                <strong>
                  {m.nombre ?? "Sin nombre"}
                  {esYo && " (tú)"}
                </strong>
                <span>{etiquetaRol(m.rol)}</span>
              </div>
              {soyPropietario && !esYo && (
                <div className="acciones">
                  <button
                    type="button"
                    className="enlace"
                    onClick={() => {
                      if (
                        window.confirm(
                          `¿Hacer propietario a ${m.nombre ?? "este miembro"}? Tú pasarás a ser miembro.`,
                        )
                      ) {
                        acciones.transferir.mutate({ espacioId, usuarioId: m.usuario_id });
                      }
                    }}
                  >
                    Hacer propietario
                  </button>
                  <button
                    type="button"
                    className="enlace"
                    onClick={() => {
                      if (window.confirm(`¿Quitar a ${m.nombre ?? "este miembro"} del espacio?`)) {
                        acciones.quitarMiembro.mutate({ espacioId, usuarioId: m.usuario_id });
                      }
                    }}
                  >
                    Quitar
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {(acciones.quitarMiembro.isError || acciones.transferir.isError) && (
        <p role="alert">
          {mensajeDeError(acciones.quitarMiembro.error ?? acciones.transferir.error)}
        </p>
      )}

      {!soyPropietario && miId && (
        <button
          type="button"
          className="secundario"
          onClick={() => {
            if (window.confirm("¿Salir de este espacio? Dejarás de ver sus nodos y avisos.")) {
              acciones.quitarMiembro.mutate(
                { espacioId, usuarioId: miId },
                { onSuccess: () => navegar("/", { replace: true }) },
              );
            }
          }}
        >
          Salir del espacio
        </button>
      )}

      {soyPropietario && (
        <>
          <h2>Invitar a alguien</h2>
          <p>Crea un enlace de un solo uso para que otra persona se una como miembro.</p>
          <button
            type="button"
            disabled={acciones.invitar.isPending}
            onClick={() => {
              setCopiado(false);
              acciones.invitar.mutate(espacioId);
            }}
          >
            Crear invitación
          </button>
          {acciones.invitar.isError && <p role="alert">{mensajeDeError(acciones.invitar.error)}</p>}
          {enlaceInvitacion && acciones.invitar.data && (
            <div className="invitacion">
              <p>
                Compártelo ahora: no volverá a mostrarse. Vence el{" "}
                {new Date(acciones.invitar.data.expira_en).toLocaleString("es-MX")}
              </p>
              <input readOnly value={enlaceInvitacion} aria-label="Enlace de invitación" />
              <button
                type="button"
                className="secundario"
                onClick={() => void copiar(enlaceInvitacion)}
              >
                {copiado ? "Copiado" : "Copiar enlace"}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
