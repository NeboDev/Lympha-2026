import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { crearCliente } from "./api/cliente.ts";
import { ContextoApi } from "./api/contexto.ts";
import { Plantilla } from "./componentes/plantilla.tsx";
import { API_URL, FIREBASE } from "./config.ts";
import { Acceso } from "./paginas/acceso.tsx";
import { Espacio } from "./paginas/espacio.tsx";
import { Espacios } from "./paginas/espacios.tsx";
import { Invitacion } from "./paginas/invitacion.tsx";
import { Nodo } from "./paginas/nodo.tsx";
import { Reclamar } from "./paginas/reclamar.tsx";
import { crearAlmacenSesion } from "./sesion/almacen.ts";
import { ProveedorSesion, RutaProtegida } from "./sesion/contexto.tsx";
import { crearServicioFirebase } from "./sesion/firebase.ts";

export function App() {
  const [almacen] = useState(() => crearAlmacenSesion(crearServicioFirebase(FIREBASE)));
  const [cliente] = useState(() =>
    crearCliente({ baseUrl: API_URL, obtenerToken: () => almacen.obtenerToken() }),
  );
  const [consultas] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } },
      }),
  );

  // Al cerrar la sesión no debe quedar en memoria nada de la cuenta anterior.
  useEffect(
    () =>
      almacen.suscribir(() => {
        if (almacen.obtenerEstado().tipo === "fuera") consultas.clear();
      }),
    [almacen, consultas],
  );

  return (
    <ProveedorSesion almacen={almacen}>
      <ContextoApi value={cliente}>
        <QueryClientProvider client={consultas}>
          <BrowserRouter>
            <Routes>
              <Route path="/acceso" element={<Acceso />} />
              <Route element={<RutaProtegida />}>
                <Route element={<Plantilla />}>
                  <Route path="/" element={<Espacios />} />
                  <Route path="/espacios/:espacioId" element={<Espacio />} />
                  <Route path="/espacios/:espacioId/reclamar" element={<Reclamar />} />
                  <Route path="/nodos/:nodoId" element={<Nodo />} />
                  <Route path="/invitacion" element={<Invitacion />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </ContextoApi>
    </ProveedorSesion>
  );
}
