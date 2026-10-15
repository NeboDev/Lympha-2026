import { usuarioApi } from "@lympha/contracts";
import { useQuery } from "@tanstack/react-query";
import { ErrorApi } from "../api/cliente.ts";
import { useApi } from "../api/contexto.ts";
import { useSesion } from "../sesion/contexto.tsx";

/** Página provisional (los espacios y el semáforo llegan en los pasos siguientes): confirma la sesión con la API. */
export function Inicio() {
  const api = useApi();
  const sesion = useSesion();
  const yo = useQuery({
    queryKey: ["yo"],
    queryFn: ({ signal }) => api.pedir("/api/yo", { esquema: usuarioApi, signal }),
    retry: false,
  });

  return (
    <main className="pagina">
      <h1>Lympha</h1>
      {yo.isPending && <p role="status">Cargando…</p>}
      {yo.data && <p role="status">Hola, {yo.data.nombre ?? yo.data.email}.</p>}
      {yo.isError && (
        <p role="alert">
          {yo.error instanceof ErrorApi && yo.error.status === 401
            ? "No pudimos validar tu sesión. Si acabas de crear tu cuenta, verifica tu correo y vuelve a entrar."
            : "No se pudo conectar con Lympha."}
        </p>
      )}
      <button type="button" className="secundario" onClick={() => void sesion.salir()}>
        Salir
      </button>
    </main>
  );
}
