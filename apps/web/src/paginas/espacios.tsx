import type { TipoEspacio } from "@lympha/contracts";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { useAccionesEspacio, useEspacios } from "../api/consultas.ts";
import { mensajeDeError } from "../api/mensajes.ts";
import { etiquetaRol, etiquetaTipo, TIPOS_ESPACIO } from "../componentes/etiquetas.ts";

/** Inicio: los espacios de la persona y el formulario para crear uno. */
export function Espacios() {
  const espacios = useEspacios();
  const { crear } = useAccionesEspacio();
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<TipoEspacio>("hogar");

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    crear.mutate({ nombre: nombre.trim(), tipo }, { onSuccess: () => setNombre("") });
  }

  return (
    <main className="pagina">
      <h1>Tus espacios</h1>

      {espacios.isPending && <p role="status">Cargando…</p>}
      {espacios.isError && <p role="alert">{mensajeDeError(espacios.error)}</p>}
      {espacios.data && espacios.data.espacios.length === 0 && (
        <p>Aún no tienes espacios. Crea el primero, por ejemplo «Mi casa».</p>
      )}
      <ul className="tarjetas">
        {espacios.data?.espacios.map((e) => (
          <li key={e.id}>
            <Link to={`/espacios/${e.id}`}>
              <strong>{e.nombre}</strong>
              <span>
                {etiquetaTipo(e.tipo)} · {etiquetaRol(e.rol)} ·{" "}
                {e.nodos === 1 ? "1 nodo" : `${e.nodos} nodos`}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <h2>Nuevo espacio</h2>
      <form onSubmit={enviar}>
        <label>
          Nombre
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            maxLength={80}
            placeholder="Mi casa"
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
        {crear.isError && <p role="alert">{mensajeDeError(crear.error)}</p>}
        <button type="submit" disabled={crear.isPending}>
          Crear espacio
        </button>
      </form>
    </main>
  );
}
