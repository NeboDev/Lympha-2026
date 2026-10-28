import type { TipoEspacio } from "@lympha/contracts";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAccionesEspacio, useYo } from "../api/consultas.ts";
import { mensajeDeError } from "../api/mensajes.ts";
import { Vacio } from "../componentes/estados.tsx";
import { etiquetaRol, etiquetaTipo, TIPOS_ESPACIO } from "../componentes/etiquetas.ts";
import {
  IcoAtras,
  IcoCopiar,
  IcoEnlace,
  IcoLapiz,
  IcoMas,
  IcoNodo,
  IcoPapelera,
  IcoPersona,
  IcoSalir,
} from "../componentes/Iconos.tsx";
import { ordenarPorUrgencia, ResumenEspacio } from "../componentes/ResumenEspacio.tsx";
import { AvisoFlujo, TarjetaNodo } from "../componentes/TarjetaNodo.tsx";
import { useAhora, useEstadoEspacio } from "../espacios/useEstadoEspacio.ts";

/** Detalle de un espacio: nodos, miembros, invitaciones y, para el propietario, edición y transferencia. */
export function Espacio() {
  const { espacioId = "" } = useParams();
  const navegar = useNavigate();
  const yo = useYo();
  const { detalle, nodos: nodosVivos, flujo } = useEstadoEspacio(espacioId);
  const ahora = useAhora();
  const acciones = useAccionesEspacio();
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<TipoEspacio>("hogar");
  const [copiado, setCopiado] = useState(false);

  if (detalle.isPending) {
    return (
      <main className="pagina">
        <p role="status" className="detalle">
          Cargando…
        </p>
      </main>
    );
  }
  if (detalle.isError) {
    return (
      <main className="pagina grid gap-3">
        <p role="alert">{mensajeDeError(detalle.error)}</p>
        <Link to="/" className="volver">
          <IcoAtras tamano={20} /> Volver a tus espacios
        </Link>
      </main>
    );
  }

  const { espacio, miembros } = detalle.data;
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
    <main className="pagina grid gap-6">
      <Link to="/" className="volver">
        <IcoAtras tamano={20} /> Tus espacios
      </Link>

      {editando ? (
        <form onSubmit={guardar} className="tarjeta m-0 p-5">
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
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={acciones.editar.isPending}>
              Guardar
            </button>
            <button type="button" className="secundario" onClick={() => setEditando(false)}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="m-0">{espacio.nombre}</h1>
            <p className="detalle m-0">
              {etiquetaTipo(espacio.tipo)} · {etiquetaRol(espacio.rol)}
            </p>
          </div>
          {soyPropietario && (
            <button
              type="button"
              className="secundario"
              onClick={() => {
                setNombre(espacio.nombre);
                setTipo(espacio.tipo);
                setEditando(true);
              }}
            >
              <IcoLapiz tamano={18} /> Editar nombre y tipo
            </button>
          )}
        </header>
      )}

      <section className="grid gap-3" aria-labelledby="h-nodos">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="h-nodos" className="m-0">
            Nodos
          </h2>
          {soyPropietario && (
            <Link to={`/espacios/${espacioId}/reclamar`} className="boton-secundario">
              <IcoMas tamano={18} /> Reclamar un nodo
            </Link>
          )}
        </div>
        <AvisoFlujo flujo={flujo} />
        <ResumenEspacio nombre={espacio.nombre} nodos={nodosVivos} />
        {nodosVivos.length === 0 && (
          <Vacio icono={IcoNodo}>Todavía no hay nodos en este espacio.</Vacio>
        )}
        <div className="rejilla">
          {ordenarPorUrgencia(nodosVivos).map((n) => (
            <TarjetaNodo key={n.id} nodo={n} ahora={ahora} />
          ))}
        </div>
      </section>

      <section className="grid gap-3" aria-labelledby="h-miembros">
        <h2 id="h-miembros" className="m-0">
          Miembros
        </h2>
        <ul className="tarjeta m-0 grid list-none gap-0 p-0">
          {miembros.map((m) => {
            const esYo = m.usuario_id === miId;
            return (
              <li
                key={m.usuario_id}
                className="flex flex-wrap items-center gap-3 border-b border-line p-3 last:border-b-0"
              >
                <span
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-text-2"
                  aria-hidden="true"
                >
                  <IcoPersona tamano={22} />
                </span>
                <div className="grid min-w-0 flex-1">
                  <strong className="truncate">
                    {m.nombre ?? "Sin nombre"}
                    {esYo && " (tú)"}
                  </strong>
                  <span className="text-sm text-text-2">{etiquetaRol(m.rol)}</span>
                </div>
                {soyPropietario && !esYo && (
                  <div className="acciones flex flex-wrap gap-1">
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
                        if (
                          window.confirm(`¿Quitar a ${m.nombre ?? "este miembro"} del espacio?`)
                        ) {
                          acciones.quitarMiembro.mutate({ espacioId, usuarioId: m.usuario_id });
                        }
                      }}
                    >
                      <IcoPapelera tamano={16} /> Quitar
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
            className="secundario justify-self-start"
            onClick={() => {
              if (window.confirm("¿Salir de este espacio? Dejarás de ver sus nodos y avisos.")) {
                acciones.quitarMiembro.mutate(
                  { espacioId, usuarioId: miId },
                  { onSuccess: () => navegar("/", { replace: true }) },
                );
              }
            }}
          >
            <IcoSalir tamano={18} /> Salir del espacio
          </button>
        )}
      </section>

      {soyPropietario && (
        <section className="tarjeta grid gap-3 p-5" aria-labelledby="h-invitar">
          <h2 id="h-invitar" className="m-0">
            Invitar a alguien
          </h2>
          <p className="m-0">
            Crea un enlace de un solo uso para que otra persona se una como miembro.
          </p>
          <button
            type="button"
            className="justify-self-start"
            disabled={acciones.invitar.isPending}
            onClick={() => {
              setCopiado(false);
              acciones.invitar.mutate(espacioId);
            }}
          >
            <IcoEnlace tamano={18} /> Crear invitación
          </button>
          {acciones.invitar.isError && <p role="alert">{mensajeDeError(acciones.invitar.error)}</p>}
          {enlaceInvitacion && acciones.invitar.data && (
            <div className="invitacion grid gap-2 rounded-ctl bg-surface-2 p-3">
              <p className="m-0 text-sm">
                Compártelo ahora: no volverá a mostrarse. Vence el{" "}
                {new Date(acciones.invitar.data.expira_en).toLocaleString("es-MX")}
              </p>
              <input
                readOnly
                value={enlaceInvitacion}
                aria-label="Enlace de invitación"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                className="secundario"
                onClick={() => void copiar(enlaceInvitacion)}
              >
                <IcoCopiar tamano={18} /> {copiado ? "Copiado" : "Copiar enlace"}
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
