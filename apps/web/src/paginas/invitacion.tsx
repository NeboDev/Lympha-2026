import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useAccionesEspacio } from "../api/consultas.ts";
import { mensajeDeError } from "../api/mensajes.ts";
import { Gota } from "../componentes/Iconos.tsx";

/** El token puede venir en el fragmento del enlace (`/invitacion#<token>`) o pegarse (solo o dentro del enlace). */
function extraerToken(texto: string): string {
  const t = texto.trim();
  const i = t.lastIndexOf("#");
  return (i >= 0 ? t.slice(i + 1) : t).trim();
}

/**
 * Aceptar una invitación a un espacio. El token va en el fragmento `#`, que el navegador no envía a ningún servidor
 * (ni queda en sus registros). Unirse es una decisión explícita: abrir el enlace no acepta nada.
 */
export function Invitacion() {
  const ubicacion = useLocation();
  const navegar = useNavigate();
  const { aceptarInvitacion } = useAccionesEspacio();
  const [texto, setTexto] = useState(() => extraerToken(ubicacion.hash));
  const token = extraerToken(texto);

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    aceptarInvitacion.mutate(token, {
      onSuccess: (r) => navegar(`/espacios/${r.espacio_id}`, { replace: true }),
    });
  }

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-md content-center gap-5 px-4 py-8">
      <div className="grid justify-items-center gap-2 text-center">
        <Gota tamano={56} />
        <h1>Unirte a un espacio</h1>
      </div>
      <div className="tarjeta grid gap-4 p-5">
        <p>
          Te invitaron a ver el agua de un espacio. Al unirte serás miembro: podrás ver sus nodos y
          recibir sus avisos.
        </p>
        <form onSubmit={enviar}>
          <label>
            Enlace o código de invitación
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
          {aceptarInvitacion.isError && (
            <p role="alert">{mensajeDeError(aceptarInvitacion.error)}</p>
          )}
          <button type="submit" disabled={aceptarInvitacion.isPending || token.length < 16}>
            Unirme al espacio
          </button>
        </form>
        <p className="text-center">
          <Link to="/">Ahora no</Link>
        </p>
      </div>
      <p className="descargo text-center">
        Lympha es una referencia del estado del agua; no sustituye un análisis de laboratorio.
      </p>
    </main>
  );
}
