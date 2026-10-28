import type { ComponentType } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { useYo } from "../api/consultas.ts";
import { useSesion } from "../sesion/contexto.tsx";
import { IcoAjustes, IcoCampana, IcoInicio, IcoSalir, Marca, type PropsIcono } from "./Iconos.tsx";

const PESTANAS: { a: string; texto: string; Icono: ComponentType<PropsIcono>; exacta?: boolean }[] =
  [
    { a: "/", texto: "Inicio", Icono: IcoInicio, exacta: true },
    { a: "/alertas", texto: "Alertas", Icono: IcoCampana },
    { a: "/ajustes", texto: "Ajustes", Icono: IcoAjustes },
  ];

/**
 * Marco de las pantallas con sesión. En el teléfono: barra superior con la marca y la persona, y las pestañas
 * abajo (al alcance del pulgar). En pantallas anchas: una barra lateral con todo. El descargo va siempre al final.
 */
export function Plantilla() {
  const sesion = useSesion();
  const yo = useYo();
  const nombre = yo.data?.nombre ?? yo.data?.email ?? "";
  return (
    <div className="min-h-dvh lg:pl-64">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-surface px-4 py-2 lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 lg:flex-col lg:items-stretch lg:gap-6 lg:border-r lg:border-b-0 lg:px-4 lg:py-6">
        <Link
          to="/"
          className="inline-flex min-h-11 items-center gap-2.5 text-xl font-medium tracking-tight text-text no-underline marca"
        >
          <Marca ancho={36} />
          lympha
        </Link>

        <nav
          aria-label="Principal"
          className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:static lg:border-0 lg:bg-transparent lg:p-0"
        >
          <ul className="m-0 grid list-none grid-cols-3 p-0 lg:grid-cols-1 lg:gap-1">
            {PESTANAS.map(({ a, texto, Icono, exacta }) => (
              <li key={a}>
                <NavLink
                  to={a}
                  end={exacta}
                  className={({ isActive }) =>
                    `flex min-h-14 flex-col items-center justify-center gap-0.5 px-2 text-xs font-bold no-underline transition-colors lg:min-h-12 lg:flex-row lg:justify-start lg:gap-3 lg:rounded-ctl lg:px-3 lg:text-base ${
                      isActive
                        ? "text-brand-text lg:bg-brand-soft"
                        : "text-text-2 hover:text-text lg:hover:bg-surface-2"
                    }`
                  }
                >
                  <Icono tamano={24} />
                  <span>{texto}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-1 lg:ml-0 lg:mt-auto lg:flex-col lg:items-stretch lg:gap-2 lg:border-t lg:border-line lg:pt-4">
          <span className="usuario flex min-w-0 items-center gap-2 text-sm font-semibold text-text-2">
            <span className="truncate">{nombre}</span>
          </span>
          <button
            type="button"
            className="enlace !gap-2 !px-3 text-sm lg:justify-start"
            onClick={() => void sesion.salir()}
          >
            <IcoSalir tamano={18} />
            Salir
          </button>
        </div>
      </header>

      <Outlet />

      <footer className="descargo mx-auto max-w-3xl px-4 pt-2 pb-28 lg:max-w-5xl lg:px-8 lg:pb-8">
        Lympha es una referencia del estado del agua; no sustituye un análisis de laboratorio.
      </footer>
    </div>
  );
}
