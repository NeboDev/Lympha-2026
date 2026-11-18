import { type FormEvent, useState } from "react";
import { mensajeDeError } from "../api/mensajes.ts";
import {
  altaNodo,
  type Comunidad as ComunidadTipo,
  type EnlaceTelegram,
  enlaceTelegram,
  comunidad as esquemaComunidad,
  eventos as esquemaEventos,
  nota as esquemaNota,
} from "../api/tipos.ts";
import { useConsulta } from "../api/use-consulta.ts";
import { estadoVisual } from "../componentes/estados.ts";
import { Icono } from "../componentes/Iconos.tsx";
import { Aviso, Cargando, ErrorConReintento, Hace, Insignia } from "../componentes/Piezas.tsx";
import { useEspacio } from "../espacio.tsx";
import { useSesion } from "../sesion/contexto.tsx";
import { esEnlaceTelegram } from "../util/enlaces.ts";
import { fechaMx } from "../util/formato.ts";
import { AjustesActuador } from "./AjustesActuador.tsx";

const TIPOS = [
  { valor: "escuela", texto: "Escuela" },
  { valor: "comite", texto: "Comité de agua" },
  { valor: "hogar", texto: "Hogar" },
  { valor: "otro", texto: "Otra" },
] as const;

const ROTULO_TIPO: Record<ComunidadTipo["tipo"], string> = {
  escuela: "Escuela",
  comite: "Comité de agua",
  hogar: "Hogar",
  otro: "Comunidad",
};

/** Pantalla 4: Comunidad. Nodos (vincular Blynk), Telegram y la bitácora. */
export function Comunidad() {
  const { comunidad, nodos, nodo } = useEspacio();
  if (!comunidad) return null;
  const responsable = comunidad.rol === "responsable";

  return (
    <>
      <header className="encabezado-nodo">
        <h1>{comunidad.nombre}</h1>
        <p className="nota">
          {ROTULO_TIPO[comunidad.tipo]} · tu rol: {responsable ? "responsable" : "integrante"}
        </p>
      </header>

      <section className="tarjeta" aria-label="Nodos">
        <h2>Nodos</h2>
        {nodos.cargando && !nodos.datos ? <Cargando /> : null}
        {nodos.error && !nodos.datos ? (
          <ErrorConReintento error={nodos.error} alReintentar={nodos.recargar} />
        ) : null}
        {nodos.datos && nodos.datos.length === 0 ? (
          <p className="nota">Todavía no hay nodos en esta comunidad.</p>
        ) : null}
        <ul className="lista">
          {(nodos.datos ?? []).map((n) => (
            <li key={n.id} className="fila-nodo">
              <div>
                <strong>{n.nombre}</strong>
                {n.ubicacion && <span className="nota">{n.ubicacion.texto}</span>}
                <span className="nota">
                  {n.ultimo ? (
                    <>
                      Último dato <Hace fecha={n.ultimo.ts} />
                    </>
                  ) : (
                    "Sin lecturas todavía"
                  )}
                </span>
              </div>
              <Insignia estado={estadoVisual(n)} />
            </li>
          ))}
        </ul>
        {responsable && (nodos.datos ?? []).map((n) => <AjustesActuador key={n.id} nodo={n} />)}
        {responsable ? (
          <VincularNodo />
        ) : (
          <p className="nota">Solo quien es responsable puede vincular nodos.</p>
        )}
      </section>

      <SeccionTelegram comunidad={comunidad} />
      {nodo ? <Bitacora nodoId={nodo.id} nodoNombre={nodo.nombre} /> : null}
      <OtraComunidad />
    </>
  );
}

function VincularNodo() {
  const { api } = useSesion();
  const { comunidad, recargar, elegirNodo } = useEspacio();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [token, setToken] = useState("");
  const [lugar, setLugar] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!comunidad) return;
    setError(null);
    setListo(null);
    setEnviando(true);
    try {
      const r = await api.pedir(`/api/comunidades/${comunidad.id}/nodos`, {
        metodo: "POST",
        cuerpo: {
          nombre: nombre.trim(),
          token_blynk: token.trim(),
          ...(lugar.trim() ? { ubicacion: { texto: lugar.trim() } } : {}),
        },
        esquema: altaNodo,
      });
      setListo(
        r.conectado
          ? `Token válido. «${r.nombre}» quedó vinculado y está conectado.`
          : `Token válido. «${r.nombre}» quedó vinculado, pero la placa no está conectada ahora: los datos llegarán cuando la enciendas.`,
      );
      setNombre("");
      setToken("");
      setLugar("");
      elegirNodo(r.id);
      recargar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  }

  if (!abierto) {
    return (
      <>
        {listo && (
          <Aviso>
            <Icono nombre="check" tamano={16} /> {listo}
          </Aviso>
        )}
        <button type="button" className="boton boton-secundario" onClick={() => setAbierto(true)}>
          <Icono nombre="mas" /> Vincular un nodo de Blynk
        </button>
      </>
    );
  }
  return (
    <form className="formulario" onSubmit={enviar}>
      <h3>Vincular un nodo de Blynk</h3>
      <label>
        Nombre del nodo
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Tinaco azotea"
          required
          minLength={2}
          maxLength={80}
        />
      </label>
      <label>
        Token de Blynk
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Pégalo desde la consola de Blynk"
          required
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
        />
        <span className="nota">
          Es el token del dispositivo. Lo guardamos cifrado y no se vuelve a mostrar.
        </span>
      </label>
      <label>
        ¿Dónde está? (opcional)
        <input
          value={lugar}
          onChange={(e) => setLugar(e.target.value)}
          placeholder="Azotea, edificio B"
          maxLength={120}
        />
      </label>
      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="acciones">
        <button type="submit" className="boton boton-primario" disabled={enviando}>
          {enviando ? "Comprobando el token…" : "Vincular"}
        </button>
        <button
          type="button"
          className="boton boton-secundario"
          onClick={() => setAbierto(false)}
          disabled={enviando}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

function SeccionTelegram({ comunidad }: { comunidad: ComunidadTipo }) {
  const { api } = useSesion();
  const [enlace, setEnlace] = useState<EnlaceTelegram | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const responsable = comunidad.rol === "responsable";

  async function pedir() {
    setError(null);
    setPidiendo(true);
    try {
      setEnlace(
        await api.pedir(`/api/comunidades/${comunidad.id}/telegram/vinculo`, {
          metodo: "POST",
          esquema: enlaceTelegram,
        }),
      );
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setPidiendo(false);
    }
  }

  return (
    <section className="tarjeta" aria-label="Telegram">
      <h2>Avisos por Telegram</h2>
      {comunidad.telegram ? (
        <p>
          <Icono nombre="check" tamano={16} /> Vinculado
          {comunidad.telegram.titulo ? ` al chat «${comunidad.telegram.titulo}»` : ""}. Ahí llegan
          las alertas y puedes pedir <code>/estado</code> y <code>/reporte</code>.
        </p>
      ) : (
        <p className="nota">
          Todavía no hay un chat vinculado. Vincúlalo para recibir las alertas donde ya conversan.
        </p>
      )}
      {error && <Aviso tipo="error">{error}</Aviso>}
      {enlace && esEnlaceTelegram(enlace.enlace) && (
        <Aviso>
          Abre este enlace en Telegram y pulsa «Iniciar». Sirve una sola vez y vence{" "}
          {fechaMx(enlace.expira)}.{" "}
          <a
            className="boton boton-primario boton-chico"
            href={enlace.enlace}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icono nombre="enviar" tamano={16} /> Abrir Telegram
          </a>
        </Aviso>
      )}
      {responsable ? (
        <button
          type="button"
          className="boton boton-secundario"
          onClick={() => void pedir()}
          disabled={pidiendo}
        >
          <Icono nombre="enviar" />{" "}
          {pidiendo
            ? "Creando el enlace…"
            : comunidad.telegram
              ? "Vincular otro chat"
              : "Vincular Telegram"}
        </button>
      ) : (
        <p className="nota">Solo quien es responsable puede vincular Telegram.</p>
      )}
    </section>
  );
}

function Bitacora({ nodoId, nodoNombre }: { nodoId: string; nodoNombre: string }) {
  const { api } = useSesion();
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lista = useConsulta(
    (signal) =>
      api.pedir(`/api/nodos/${nodoId}/eventos?limite=50`, { esquema: esquemaEventos, signal }),
    [api, nodoId],
  );
  const notas = (lista.datos?.eventos ?? []).filter((e) => e.tipo === "bitacora");

  async function anotar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await api.pedir(`/api/nodos/${nodoId}/bitacora`, {
        metodo: "POST",
        cuerpo: { texto: texto.trim() },
        esquema: esquemaNota,
      });
      setTexto("");
      lista.recargar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="tarjeta tarjeta-bitacora" aria-label="Bitácora">
      <h2>Bitácora de «{nodoNombre}»</h2>
      <p className="nota">
        Lo que la comunidad hace por el agua queda en el reporte: lavar el tinaco, cambiar la sonda,
        agregar cloro…
      </p>
      <form className="formulario" onSubmit={anotar}>
        <label>
          ¿Qué se hizo?
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            maxLength={500}
            required
            placeholder="Se lavó el tinaco y se cambió la sonda de pH."
          />
        </label>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button
          type="submit"
          className="boton boton-barro"
          disabled={enviando || texto.trim() === ""}
        >
          <Icono nombre="cuaderno" /> {enviando ? "Guardando…" : "Anotar en la bitácora"}
        </button>
      </form>
      {lista.cargando && !lista.datos ? <Cargando /> : null}
      {lista.datos && notas.length === 0 ? <p className="nota">Todavía no hay notas.</p> : null}
      <ul className="lista lista-notas">
        {notas.map((n) => (
          <li key={`${n.ts.getTime()}-${n.mensaje.slice(0, 12)}`}>
            <span className="nota">
              {fechaMx(n.ts)} · {n.propia ? "tú" : "alguien de la comunidad"}
            </span>
            <span>{n.mensaje}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Crear una comunidad nueva (la primera o una más). */
export function NuevaComunidad({ alCrear }: { alCrear?: () => void }) {
  const { api } = useSesion();
  const { recargar, elegirComunidad } = useEspacio();
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]["valor"]>("escuela");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crear(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const c = await api.pedir("/api/comunidades", {
        metodo: "POST",
        cuerpo: { nombre: nombre.trim(), tipo },
        esquema: esquemaComunidad,
      });
      setNombre("");
      elegirComunidad(c.id);
      recargar();
      alCrear?.();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="formulario" onSubmit={crear}>
      <label>
        Nombre de la comunidad
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Primaria Benito Juárez"
          required
          minLength={2}
          maxLength={80}
        />
      </label>
      <label>
        Tipo
        <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
          {TIPOS.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.texto}
            </option>
          ))}
        </select>
      </label>
      {error && <Aviso tipo="error">{error}</Aviso>}
      <button type="submit" className="boton boton-primario" disabled={enviando}>
        <Icono nombre="mas" /> {enviando ? "Creando…" : "Crear comunidad"}
      </button>
    </form>
  );
}

function OtraComunidad() {
  const { yo, elegirComunidad, comunidad } = useEspacio();
  const otras = (yo.datos?.comunidades ?? []).filter((c) => c.id !== comunidad?.id);
  return (
    <section className="tarjeta" aria-label="Otras comunidades">
      <h2>Otras comunidades</h2>
      {otras.length > 0 ? (
        <ul className="lista">
          {otras.map((c) => (
            <li key={c.id} className="fila-nodo">
              <div>
                <strong>{c.nombre}</strong>
                <span className="nota">
                  {c.rol === "responsable" ? "responsable" : "integrante"}
                </span>
              </div>
              <button
                type="button"
                className="boton boton-secundario boton-chico"
                onClick={() => elegirComunidad(c.id)}
              >
                Cambiar a esta
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <details>
        <summary>Crear otra comunidad</summary>
        <NuevaComunidad />
      </details>
    </section>
  );
}
