import type { EstadoSesion, ServicioSesion } from "./servicio.ts";

/**
 * Estado de la sesión como almacén externo (sin React): `useSyncExternalStore` lo lee y las pruebas lo ejercen con
 * un servicio falso. Solo escucha a Firebase mientras haya alguien suscrito.
 */
export interface AlmacenSesion {
  obtenerEstado(): EstadoSesion;
  suscribir(oyente: () => void): () => void;
  obtenerToken: ServicioSesion["obtenerToken"];
  entrar: ServicioSesion["entrar"];
  crearCuenta: ServicioSesion["crearCuenta"];
  entrarConGoogle: ServicioSesion["entrarConGoogle"];
  salir: ServicioSesion["salir"];
}

export function crearAlmacenSesion(servicio: ServicioSesion): AlmacenSesion {
  let estado: EstadoSesion = { tipo: "cargando" };
  const oyentes = new Set<() => void>();
  let dejarDeEscuchar: (() => void) | null = null;

  const fijar = (nuevo: EstadoSesion) => {
    estado = nuevo;
    for (const oyente of [...oyentes]) oyente();
  };

  return {
    obtenerEstado: () => estado,

    suscribir(oyente) {
      oyentes.add(oyente);
      dejarDeEscuchar ??= servicio.alCambiar((usuario) =>
        fijar(usuario ? { tipo: "dentro", usuario } : { tipo: "fuera" }),
      );
      return () => {
        oyentes.delete(oyente);
        if (oyentes.size === 0 && dejarDeEscuchar) {
          dejarDeEscuchar();
          dejarDeEscuchar = null;
          // Sin nadie escuchando no se sabe si la sesión sigue viva: la próxima suscripción la vuelve a leer.
          estado = { tipo: "cargando" };
        }
      };
    },

    obtenerToken: () => servicio.obtenerToken(),
    entrar: (correo, contrasena) => servicio.entrar(correo, contrasena),
    crearCuenta: (correo, contrasena, nombre) => servicio.crearCuenta(correo, contrasena, nombre),
    entrarConGoogle: () => servicio.entrarConGoogle(),
    salir: () => servicio.salir(),
  };
}
