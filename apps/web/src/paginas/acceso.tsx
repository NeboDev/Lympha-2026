import { type FormEvent, useState } from "react";
import { Navigate, useLocation } from "react-router";
import { Gota } from "../componentes/Iconos.tsx";
import { useSesion } from "../sesion/contexto.tsx";
import { ErrorAcceso } from "../sesion/servicio.ts";

type Modo = "entrar" | "crear";

/** Destino al que volver tras entrar: solo rutas internas (nunca un enlace externo puesto en el estado). */
function destinoSeguro(desde: unknown): string {
  return typeof desde === "string" && desde.startsWith("/") && !desde.startsWith("//")
    ? desde
    : "/";
}

export function Acceso() {
  const sesion = useSesion();
  const ubicacion = useLocation();
  const [modo, setModo] = useState<Modo>("entrar");
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enCurso, setEnCurso] = useState(false);

  if (sesion.estado.tipo === "dentro") {
    return (
      <Navigate
        to={destinoSeguro((ubicacion.state as { desde?: unknown } | null)?.desde)}
        replace
      />
    );
  }

  async function intentar(tarea: () => Promise<void>) {
    setError(null);
    setEnCurso(true);
    try {
      await tarea();
    } catch (e) {
      setError(e instanceof ErrorAcceso ? e.message : "No se pudo completar el acceso.");
    } finally {
      setEnCurso(false);
    }
  }

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    void intentar(() =>
      modo === "entrar"
        ? sesion.entrar(correo.trim(), contrasena)
        : sesion.crearCuenta(correo.trim(), contrasena, nombre.trim()),
    );
  }

  const creando = modo === "crear";
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-md content-center gap-5 px-4 py-8">
      <div className="grid justify-items-center gap-2 text-center">
        <Gota tamano={56} />
        <h1>Lympha</h1>
        <p className="text-text-2">
          {creando ? "Crea tu cuenta" : "Entra para ver el agua de tu espacio"}
        </p>
      </div>
      <div className="tarjeta grid gap-4 p-5">
        <form onSubmit={enviar} className="m-0">
          {creando && (
            <label>
              Tu nombre
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                autoComplete="name"
                maxLength={80}
                required
              />
            </label>
          )}
          <label>
            Correo
            <input
              type="email"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              value={contrasena}
              onChange={(e) => setContrasena(e.target.value)}
              autoComplete={creando ? "new-password" : "current-password"}
              minLength={creando ? 6 : undefined}
              required
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={enCurso}>
            {creando ? "Crear cuenta" : "Entrar"}
          </button>
        </form>

        <button
          type="button"
          className="secundario w-full"
          disabled={enCurso}
          onClick={() => void intentar(sesion.entrarConGoogle)}
        >
          Continuar con Google
        </button>

        <p className="text-center">
          <button
            type="button"
            className="enlace"
            onClick={() => {
              setError(null);
              setModo(creando ? "entrar" : "crear");
            }}
          >
            {creando ? "Ya tengo cuenta" : "Crear una cuenta"}
          </button>
        </p>
      </div>
      <p className="descargo text-center">
        Lympha es una referencia del estado del agua; no sustituye un análisis de laboratorio.
      </p>
    </main>
  );
}
