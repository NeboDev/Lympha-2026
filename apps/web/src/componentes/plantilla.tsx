import { Link, Outlet } from "react-router";
import { useYo } from "../api/consultas.ts";
import { useSesion } from "../sesion/contexto.tsx";

/** Marco de las pantallas con sesión: encabezado, salir y el descargo de siempre visible. */
export function Plantilla() {
  const sesion = useSesion();
  const yo = useYo();
  return (
    <>
      <header className="encabezado">
        <Link to="/" className="marca">
          Lympha
        </Link>
        <span className="usuario">{yo.data?.nombre ?? yo.data?.email ?? ""}</span>
        <button type="button" className="enlace" onClick={() => void sesion.salir()}>
          Salir
        </button>
      </header>
      <Outlet />
      <footer className="descargo">
        Lympha es una referencia del estado del agua; no sustituye un análisis de laboratorio.
      </footer>
    </>
  );
}
