import { respuestaHealth } from "@lympha/contracts";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "../api/contexto.ts";

/** Página provisional del andamiaje: comprueba que la PWA alcanza la API (CORS incluido). */
export function Inicio() {
  const api = useApi();
  const salud = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => api.pedir("/health", { esquema: respuestaHealth, signal }),
  });

  return (
    <main className="pagina">
      <h1>Lympha</h1>
      <p>Calidad del agua de tu cisterna, en un vistazo.</p>
      <p role="status" data-estado={salud.isError ? "error" : (salud.data?.estado ?? "cargando")}>
        {salud.isPending && "Conectando con Lympha…"}
        {salud.isError && "No se pudo conectar con Lympha."}
        {salud.data && `Servicio: ${salud.data.estado === "ok" ? "en línea" : "con fallas"}`}
      </p>
    </main>
  );
}
