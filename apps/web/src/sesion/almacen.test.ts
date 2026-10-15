import { describe, expect, it } from "vitest";
import { crearAlmacenSesion } from "./almacen.ts";
import type { ServicioSesion, UsuarioSesion } from "./servicio.ts";

const ANA: UsuarioSesion = { uid: "u1", correo: "ana@example.com", nombre: "Ana" };

/** Servicio falso: la prueba decide cuándo Firebase "responde" con la sesión. */
function servicioFalso() {
  let oyente: ((u: UsuarioSesion | null) => void) | null = null;
  const llamadas: string[] = [];
  const servicio: ServicioSesion = {
    alCambiar(o) {
      llamadas.push("escuchar");
      oyente = o;
      return () => {
        llamadas.push("dejar");
        oyente = null;
      };
    },
    obtenerToken: async () => "tok",
    entrar: async () => undefined,
    crearCuenta: async () => undefined,
    entrarConGoogle: async () => undefined,
    salir: async () => {
      llamadas.push("salir");
    },
  };
  return {
    servicio,
    llamadas,
    emitir: (u: UsuarioSesion | null) => oyente?.(u),
    oyente: () => oyente,
  };
}

describe("almacén de sesión", () => {
  it("empieza cargando y no escucha a Firebase hasta que alguien se suscribe", () => {
    const f = servicioFalso();
    const a = crearAlmacenSesion(f.servicio);
    expect(a.obtenerEstado()).toEqual({ tipo: "cargando" });
    expect(f.llamadas).toEqual([]);
    a.suscribir(() => undefined);
    expect(f.llamadas).toEqual(["escuchar"]);
  });

  it("pasa a dentro con el usuario y a fuera sin él, avisando a los suscritos", () => {
    const f = servicioFalso();
    const a = crearAlmacenSesion(f.servicio);
    let avisos = 0;
    a.suscribir(() => avisos++);
    f.emitir(ANA);
    expect(a.obtenerEstado()).toEqual({ tipo: "dentro", usuario: ANA });
    f.emitir(null);
    expect(a.obtenerEstado()).toEqual({ tipo: "fuera" });
    expect(avisos).toBe(2);
  });

  it("varios suscritos comparten una sola escucha y se deja de escuchar con el último", () => {
    const f = servicioFalso();
    const a = crearAlmacenSesion(f.servicio);
    const baja1 = a.suscribir(() => undefined);
    const baja2 = a.suscribir(() => undefined);
    expect(f.llamadas).toEqual(["escuchar"]);
    baja1();
    expect(f.oyente()).not.toBeNull();
    f.emitir(ANA);
    baja2();
    expect(f.oyente()).toBeNull();
    // sin nadie escuchando no se afirma que la sesión siga abierta
    expect(a.obtenerEstado()).toEqual({ tipo: "cargando" });
  });

  it("delega el token y las acciones de acceso en el servicio", async () => {
    const f = servicioFalso();
    const a = crearAlmacenSesion(f.servicio);
    expect(await a.obtenerToken()).toBe("tok");
    await a.salir();
    expect(f.llamadas).toContain("salir");
  });
});
