import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import type { AlmacenSesion } from "./almacen.ts";
import type { EstadoSesion } from "./servicio.ts";

const ContextoSesion = createContext<AlmacenSesion | null>(null);

export function ProveedorSesion({
  almacen,
  children,
}: {
  almacen: AlmacenSesion;
  children: ReactNode;
}) {
  return <ContextoSesion value={almacen}>{children}</ContextoSesion>;
}

/** Estado de la sesión y las acciones de acceso. Solo dentro de `<ProveedorSesion>`. */
export function useSesion(): AlmacenSesion & { estado: EstadoSesion } {
  const almacen = useContext(ContextoSesion);
  if (!almacen) throw new Error("useSesion fuera de <ProveedorSesion>");
  const estado = useSyncExternalStore(almacen.suscribir, almacen.obtenerEstado);
  return { ...almacen, estado };
}

/** Deja pasar solo con sesión abierta; si no, manda a `/acceso` y recuerda a dónde volver. */
export function RutaProtegida() {
  const { estado } = useSesion();
  const ubicacion = useLocation();
  if (estado.tipo === "cargando")
    return (
      <p role="status" className="pagina detalle">
        Cargando…
      </p>
    );
  if (estado.tipo === "fuera") {
    return (
      <Navigate
        to="/acceso"
        replace
        state={{ desde: ubicacion.pathname + ubicacion.search + ubicacion.hash }}
      />
    );
  }
  return <Outlet />;
}
