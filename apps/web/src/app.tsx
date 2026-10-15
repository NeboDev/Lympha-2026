import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { crearCliente } from "./api/cliente.ts";
import { ContextoApi } from "./api/contexto.ts";
import { API_URL } from "./config.ts";
import { Inicio } from "./paginas/inicio.tsx";

export function App() {
  const [cliente] = useState(() => crearCliente({ baseUrl: API_URL }));
  const [consultas] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } },
      }),
  );
  return (
    <ContextoApi value={cliente}>
      <QueryClientProvider client={consultas}>
        <BrowserRouter>
          <Routes>
            <Route path="*" element={<Inicio />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ContextoApi>
  );
}
