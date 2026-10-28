import type { LoteAdminApi, NodoAdminApi } from "@lympha/contracts";
import { type FormEvent, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useParams, useSearchParams } from "react-router";
import { Confirmar } from "../admin/Confirmar.tsx";
import { EntregaEtiquetas } from "../admin/EntregaEtiquetas.tsx";
import type { LoteEntregado } from "../admin/entrega.ts";
import { ESTADO_NODO, ESTADOS_NODO, fechaCorta } from "../admin/estados.ts";
import { useYo } from "../api/consultas.ts";
import {
  POR_PAGINA,
  useAccionesAdmin,
  useLotesAdmin,
  useNodoAdmin,
  useNodosAdmin,
} from "../api/consultas-admin.ts";
import { mensajeDeError } from "../api/mensajes.ts";
import { Insignia, Vacio } from "../componentes/estados.tsx";
import { IcoAdelante, IcoAtras, IcoInfo, IcoQr } from "../componentes/Iconos.tsx";

/** Solo entra quien la API reconoce como admin de plataforma (`es_admin`); a los demás los manda al inicio. */
export function RutaAdmin() {
  const yo = useYo();
  if (yo.isPending) {
    return (
      <p role="status" className="pagina detalle">
        Cargando…
      </p>
    );
  }
  if (!yo.data?.es_admin) return <Navigate to="/" replace />;
  return (
    <main className="pagina grid gap-6">
      <header className="grid gap-3">
        <div>
          <h1 className="m-0">Administración</h1>
          <p className="detalle m-0">Lotes, etiquetas y boyas de la plataforma</p>
        </div>
        <nav aria-label="Administración" className="flex gap-2">
          {(
            [
              ["/admin", "Lotes", true],
              ["/admin/nodos", "Nodos", false],
            ] as const
          ).map(([a, texto, exacta]) => (
            <NavLink
              key={a}
              to={a}
              end={exacta}
              className={({ isActive }) =>
                `inline-flex min-h-11 items-center rounded-ctl border px-4 font-bold no-underline ${
                  isActive
                    ? "border-brand bg-brand-soft text-brand-text"
                    : "border-line-strong text-text-2 hover:text-text"
                }`
              }
            >
              {texto}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </main>
  );
}

function Cargando() {
  return (
    <p role="status" className="detalle m-0">
      Cargando…
    </p>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm font-bold">
      {etiqueta}
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Lotes
// ---------------------------------------------------------------------------------------------------------

function CrearLote({ alCrear }: { alCrear: (l: LoteEntregado) => void }) {
  const { crearLote } = useAccionesAdmin();
  const [cantidad, setCantidad] = useState("10");
  const [versionHw, setVersionHw] = useState("v1");
  const [notas, setNotas] = useState("");

  function enviar(e: FormEvent) {
    e.preventDefault();
    const n = Number(cantidad);
    if (!Number.isInteger(n)) return;
    crearLote.mutate(
      {
        cantidad: n,
        version_hw: versionHw.trim() || "v1",
        ...(notas.trim() ? { notas: notas.trim() } : {}),
      },
      {
        onSuccess: (r) =>
          alCrear({
            loteId: r.lote_id,
            creadoEn: r.creado_en,
            versionHw: r.version_hw,
            etiquetas: r.etiquetas,
          }),
      },
    );
  }

  return (
    <form onSubmit={enviar} className="tarjeta grid gap-4 p-4" aria-labelledby="crear-lote">
      <h2 id="crear-lote" className="m-0">
        Crear lote
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo etiqueta="Cantidad de nodos (1 a 50)">
          <input
            type="number"
            min={1}
            max={50}
            required
            inputMode="numeric"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
          />
        </Campo>
        <Campo etiqueta="Versión de hardware">
          <input
            required
            maxLength={40}
            value={versionHw}
            onChange={(e) => setVersionHw(e.target.value)}
          />
        </Campo>
        <Campo etiqueta="Notas (opcional)">
          <input maxLength={200} value={notas} onChange={(e) => setNotas(e.target.value)} />
        </Campo>
      </div>
      <p className="detalle m-0">
        Al crearlo verás las etiquetas listas para imprimir. Los códigos se muestran una sola vez.
      </p>
      {crearLote.isError && (
        <p role="alert" className="m-0">
          {mensajeDeError(crearLote.error)}
        </p>
      )}
      <button type="submit" className="justify-self-start" disabled={crearLote.isPending}>
        <IcoQr tamano={18} /> {crearLote.isPending ? "Creando…" : "Crear lote y generar etiquetas"}
      </button>
    </form>
  );
}

function FilaLote({ lote }: { lote: LoteAdminApi }) {
  const { revocarLote } = useAccionesAdmin();
  const total = lote.cantidad;
  return (
    <li className="tarjeta grid gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="min-w-0 flex-1 break-all">{lote.id}</strong>
        {lote.revocado_en ? (
          <Insignia estado="deshabilitado" texto="Lote deshabilitado" />
        ) : (
          <Insignia estado="buena" texto="Vigente" />
        )}
      </div>
      <p className="detalle m-0">
        {fechaCorta(lote.creado_en)} · hardware {lote.version_hw} · {total} nodos
        {lote.notas ? ` · ${lote.notas}` : ""}
      </p>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0 text-sm">
        {ESTADOS_NODO.map((e) => (
          <li key={e} className="rounded-full border border-line-strong px-2.5 py-0.5">
            {ESTADO_NODO[e].texto}: <strong>{lote.nodos[e]}</strong>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-start gap-3">
        <Link className="boton-secundario" to={`/admin/nodos?lote=${lote.id}`}>
          Ver nodos <IcoAdelante tamano={18} />
        </Link>
        {!lote.revocado_en && (
          <Confirmar
            etiqueta="Deshabilitar lote…"
            aviso={`Se desconectará y se bloqueará a los ${total} nodos del lote, y se cerrarán sus alertas. No se puede deshacer.`}
            textoConfirmar="Sí, deshabilitar el lote completo"
            pendiente={revocarLote.isPending}
            error={revocarLote.isError ? mensajeDeError(revocarLote.error) : null}
            alConfirmar={() => revocarLote.mutate(lote.id)}
          />
        )}
      </div>
    </li>
  );
}

export function AdminLotes() {
  const lotes = useLotesAdmin();
  const [entregado, setEntregado] = useState<LoteEntregado | null>(null);

  if (entregado) {
    return (
      <EntregaEtiquetas
        lote={entregado}
        titulo={`Lote creado: ${entregado.etiquetas.length} etiquetas`}
        alCerrar={() => setEntregado(null)}
      />
    );
  }
  return (
    <div className="grid gap-6">
      <CrearLote alCrear={setEntregado} />
      <section className="grid gap-3" aria-labelledby="lista-lotes">
        <h2 id="lista-lotes" className="m-0">
          Lotes
        </h2>
        {lotes.isPending && <Cargando />}
        {lotes.isError && <p role="alert">{mensajeDeError(lotes.error)}</p>}
        {lotes.data?.lotes.length === 0 && <Vacio icono={IcoInfo}>Aún no hay lotes.</Vacio>}
        <ul className="m-0 grid list-none gap-3 p-0">
          {lotes.data?.lotes.map((l) => (
            <FilaLote key={l.id} lote={l} />
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Nodos
// ---------------------------------------------------------------------------------------------------------

function FilaNodo({ nodo }: { nodo: NodoAdminApi }) {
  const e = ESTADO_NODO[nodo.estado];
  return (
    <li>
      <Link
        to={`/admin/nodos/${nodo.id}`}
        className="tarjeta flex flex-wrap items-center gap-3 p-4 text-text no-underline hover:bg-surface-2"
      >
        <span className="min-w-0 flex-1 break-all font-semibold">{nodo.id}</span>
        <Insignia estado={e.visible} texto={e.texto} />
        <IcoAdelante tamano={18} />
      </Link>
    </li>
  );
}

export function AdminNodos() {
  const [params, setParams] = useSearchParams();
  const filtros = {
    lote: params.get("lote") ?? "",
    estado: params.get("estado") ?? "",
    q: params.get("q") ?? "",
    pagina: Math.max(0, Number(params.get("pagina") ?? 0) || 0),
  };
  const nodos = useNodosAdmin(filtros);
  const lotes = useLotesAdmin();

  function cambiar(cambios: Partial<Record<"lote" | "estado" | "q" | "pagina", string>>) {
    const nuevo = new URLSearchParams(params);
    for (const [k, v] of Object.entries(cambios)) {
      if (v) nuevo.set(k, v);
      else nuevo.delete(k);
    }
    if (!("pagina" in cambios)) nuevo.delete("pagina");
    setParams(nuevo, { replace: true });
  }

  const total = nodos.data?.total ?? 0;
  const ultima = Math.max(0, Math.ceil(total / POR_PAGINA) - 1);

  return (
    <section className="grid gap-4" aria-labelledby="lista-nodos">
      <h2 id="lista-nodos" className="m-0">
        Nodos
      </h2>
      <div className="tarjeta grid gap-3 p-4 sm:grid-cols-3">
        <Campo etiqueta="Estado">
          <select value={filtros.estado} onChange={(e) => cambiar({ estado: e.target.value })}>
            <option value="">Todos</option>
            {ESTADOS_NODO.map((e) => (
              <option key={e} value={e}>
                {ESTADO_NODO[e].texto}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Lote">
          <select value={filtros.lote} onChange={(e) => cambiar({ lote: e.target.value })}>
            <option value="">Todos</option>
            {lotes.data?.lotes.map((l) => (
              <option key={l.id} value={l.id}>
                {fechaCorta(l.creado_en)} · {l.cantidad} nodos
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Buscar por identificador">
          <input
            type="search"
            value={filtros.q}
            maxLength={40}
            placeholder="Parte del identificador"
            onChange={(e) => cambiar({ q: e.target.value })}
          />
        </Campo>
      </div>

      {nodos.isPending && <Cargando />}
      {nodos.isError && <p role="alert">{mensajeDeError(nodos.error)}</p>}
      {nodos.data && nodos.data.nodos.length === 0 && (
        <Vacio icono={IcoInfo}>No hay nodos con esos filtros.</Vacio>
      )}
      {nodos.data && nodos.data.nodos.length > 0 && (
        <p className="detalle m-0" aria-live="polite">
          {total} {total === 1 ? "nodo" : "nodos"} · página {filtros.pagina + 1} de {ultima + 1}
        </p>
      )}
      <ul className="m-0 grid list-none gap-2 p-0">
        {nodos.data?.nodos.map((n) => (
          <FilaNodo key={n.id} nodo={n} />
        ))}
      </ul>
      {total > POR_PAGINA && (
        <div className="flex gap-2">
          <button
            type="button"
            className="secundario"
            disabled={filtros.pagina === 0}
            onClick={() => cambiar({ pagina: String(filtros.pagina - 1) })}
          >
            <IcoAtras tamano={18} /> Anterior
          </button>
          <button
            type="button"
            className="secundario"
            disabled={filtros.pagina >= ultima}
            onClick={() => cambiar({ pagina: String(filtros.pagina + 1) })}
          >
            Siguiente <IcoAdelante tamano={18} />
          </button>
        </div>
      )}
    </section>
  );
}

export function AdminNodo() {
  const { nodoId = "" } = useParams();
  const nodo = useNodoAdmin(nodoId);
  const { perteneceA, regenerar, revocarNodo } = useAccionesAdmin();
  const [entregado, setEntregado] = useState<LoteEntregado | null>(null);

  if (entregado) {
    return (
      <EntregaEtiquetas
        lote={entregado}
        titulo="Etiqueta regenerada: el código anterior ya no sirve"
        alCerrar={() => setEntregado(null)}
      />
    );
  }
  const n = nodo.data;
  const e = n ? ESTADO_NODO[n.estado] : null;
  const pertenece = perteneceA.data;

  return (
    <div className="grid gap-5">
      <Link to="/admin/nodos" className="inline-flex min-h-11 items-center gap-1 no-underline">
        <IcoAtras tamano={18} /> Nodos
      </Link>
      {nodo.isPending && <Cargando />}
      {nodo.isError && <p role="alert">{mensajeDeError(nodo.error)}</p>}
      {n && e && (
        <>
          <header className="tarjeta grid gap-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 min-w-0 flex-1 break-all">{n.id}</h2>
              <Insignia estado={e.visible} texto={e.texto} grande />
            </div>
            <p className="detalle m-0">
              Lote <Link to={`/admin/nodos?lote=${n.lote.id}`}>{fechaCorta(n.lote.creado_en)}</Link>{" "}
              · hardware {n.lote.version_hw} · creado {fechaCorta(n.creado_en)}
              {n.reclamado_en ? ` · reclamado ${fechaCorta(n.reclamado_en)}` : ""}
              {n.version_fw ? ` · firmware ${n.version_fw}` : ""}
            </p>
            {n.lote.revocado_en && (
              <p className="m-0">El lote fue deshabilitado el {fechaCorta(n.lote.revocado_en)}.</p>
            )}
          </header>

          <section className="tarjeta grid gap-3 p-4" aria-labelledby="pertenece">
            <h3 id="pertenece" className="m-0">
              Pertenece a
            </h3>
            <p className="m-0 flex items-start gap-2">
              <IcoInfo tamano={18} className="mt-0.5 shrink-0" />
              <span>
                Solo para soporte. Cada vez que consultas esto <strong>queda registrado</strong> en
                la auditoría con tu usuario y este nodo. Aquí no se muestran lecturas, índices ni
                alertas del agua.
              </span>
            </p>
            {!pertenece && (
              <button
                type="button"
                className="secundario justify-self-start"
                disabled={perteneceA.isPending}
                onClick={() => perteneceA.mutate(n.id)}
              >
                {perteneceA.isPending ? "Consultando…" : "Ver a quién pertenece (queda registrado)"}
              </button>
            )}
            {perteneceA.isError && (
              <p role="alert" className="m-0">
                {mensajeDeError(perteneceA.error)}
              </p>
            )}
            {pertenece &&
              (pertenece.espacio_id ? (
                <dl className="m-0 grid gap-1">
                  <dt className="detalle">Espacio</dt>
                  <dd className="m-0 font-semibold">{pertenece.espacio_nombre}</dd>
                  <dt className="detalle">Propietario</dt>
                  <dd className="m-0 font-semibold">
                    {pertenece.propietario_nombre ?? "Sin nombre"}
                  </dd>
                  <dd className="m-0 break-all">{pertenece.propietario_email}</dd>
                </dl>
              ) : (
                <p className="m-0">
                  Este nodo no pertenece a ningún espacio. La consulta quedó registrada.
                </p>
              ))}
          </section>

          <section className="tarjeta grid gap-3 p-4" aria-labelledby="etiqueta">
            <h3 id="etiqueta" className="m-0">
              Etiqueta
            </h3>
            {n.estado === "fabricado" && !n.lote.revocado_en ? (
              <>
                <p className="m-0">
                  Los códigos no se guardan, así que una etiqueta no se puede reimprimir. Si se
                  perdió, regenérala: el código impreso <strong>deja de servir</strong> y se crean
                  una clave de punto de acceso y una contraseña nuevas; habrá que volver a grabar la
                  identidad del nodo.
                </p>
                {regenerar.isError && (
                  <p role="alert" className="m-0">
                    {mensajeDeError(regenerar.error)}
                  </p>
                )}
                <Confirmar
                  etiqueta="Regenerar etiqueta…"
                  aviso="El código, la clave del punto de acceso y la contraseña actuales se invalidan. La etiqueta nueva se muestra una sola vez."
                  textoConfirmar="Sí, regenerar y mostrar la etiqueta"
                  pendiente={regenerar.isPending}
                  alConfirmar={() =>
                    regenerar.mutate(n.id, {
                      onSuccess: (r) =>
                        setEntregado({
                          loteId: n.lote.id,
                          creadoEn: new Date().toISOString(),
                          versionHw: n.lote.version_hw,
                          etiquetas: [r.etiqueta],
                        }),
                    })
                  }
                />
              </>
            ) : (
              <p className="m-0">
                {n.estado === "revocado" || n.lote.revocado_en
                  ? "El nodo está deshabilitado: no se regenera su etiqueta."
                  : "Un nodo ya reclamado no se regenera: desvincúlalo primero (lo hace la persona propietaria desde la app)."}
              </p>
            )}
          </section>

          {n.estado !== "revocado" && (
            <section className="tarjeta grid gap-3 p-4" aria-labelledby="deshabilitar">
              <h3 id="deshabilitar" className="m-0">
                Deshabilitar nodo
              </h3>
              <p className="m-0">
                Lo desconecta del broker, le quita el espacio y cierra sus alertas. No se puede
                deshacer.
              </p>
              <Confirmar
                etiqueta="Deshabilitar nodo…"
                aviso="El nodo se desconectará y no podrá volver a enviar datos. ¿Continuar?"
                textoConfirmar="Sí, deshabilitar este nodo"
                pendiente={revocarNodo.isPending}
                error={revocarNodo.isError ? mensajeDeError(revocarNodo.error) : null}
                alConfirmar={() => revocarNodo.mutate(n.id)}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
