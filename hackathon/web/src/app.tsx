import { Icono, type NombreIcono } from "./componentes/Iconos.tsx";
import { Aviso, Cargando, Marca } from "./componentes/Piezas.tsx";
import { ProveedorEspacio, useEspacio } from "./espacio.tsx";
import { Comunidad, NuevaComunidad } from "./paginas/Comunidad.tsx";
import { Entrar } from "./paginas/Entrar.tsx";
import { MiAgua } from "./paginas/MiAgua.tsx";
import { Reportes } from "./paginas/Reportes.tsx";
import { type Ruta, useRuta } from "./ruta.ts";
import { ProveedorSesion, useSesion } from "./sesion/contexto.tsx";

export function App() {
  return (
    <ProveedorSesion>
      <Puerta />
    </ProveedorSesion>
  );
}

/** Sin sesión, la pantalla de entrada; con sesión, la aplicación. */
function Puerta() {
  const { estado } = useSesion();
  if (estado.tipo === "cargando") return <Cargando texto="Abriendo Atl…" />;
  if (estado.tipo === "fuera") return <Entrar />;
  return (
    <ProveedorEspacio>
      <Marco />
    </ProveedorEspacio>
  );
}

const PESTANAS: { ruta: Ruta; texto: string; icono: NombreIcono }[] = [
  { ruta: "agua", texto: "Mi agua", icono: "gota" },
  { ruta: "reportes", texto: "Reportes", icono: "documento" },
  { ruta: "comunidad", texto: "Comunidad", icono: "personas" },
];

function Marco() {
  const sesion = useSesion();
  const { yo, comunidad, nodos, nodo, elegirComunidad, elegirNodo } = useEspacio();
  const [ruta, ir] = useRuta();

  if (yo.cargando && !yo.datos) return <Cargando texto="Cargando tu comunidad…" />;
  if (!yo.datos) {
    return (
      <main className="centro">
        <Aviso
          tipo="error"
          accion={
            <button type="button" className="boton boton-secundario" onClick={yo.recargar}>
              Intentar de nuevo
            </button>
          }
        >
          {yo.error ?? "No pudimos cargar tu cuenta."}
        </Aviso>
        <button
          type="button"
          className="boton boton-secundario"
          onClick={() => void sesion.salir()}
        >
          Salir
        </button>
      </main>
    );
  }

  const persona = sesion.estado.tipo === "dentro" ? sesion.estado.persona : null;
  const comunidades = yo.datos.comunidades;

  return (
    <div className="marco">
      <header className="barra">
        <div className="barra-marca">
          <Marca tamano={28} />
          <span className="barra-nombre">Atl</span>
        </div>
        <div className="barra-selectores">
          {comunidades.length > 1 && (
            <label className="selector">
              <span className="solo-lectores">Comunidad</span>
              <select value={comunidad?.id} onChange={(e) => elegirComunidad(e.target.value)}>
                {comunidades.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(nodos.datos?.length ?? 0) > 1 && (
            <label className="selector">
              <span className="solo-lectores">Nodo</span>
              <select value={nodo?.id} onChange={(e) => elegirNodo(e.target.value)}>
                {(nodos.datos ?? []).map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <button
          type="button"
          className="boton-icono"
          onClick={() => void sesion.salir()}
          title="Salir"
          aria-label={`Salir${persona?.nombre ? ` (${persona.nombre})` : ""}`}
        >
          <Icono nombre="salir" />
        </button>
      </header>

      {sesion.estado.tipo === "dentro" && sesion.estado.demo && (
        <p className="franja-demo" role="status">
          Estás en la cuenta de demostración.
        </p>
      )}

      <main className="contenido" id="contenido">
        {!comunidad ? (
          <section className="tarjeta">
            <h1>Crea tu comunidad</h1>
            <p className="nota">
              Una comunidad agrupa a quienes vigilan el mismo agua: una escuela, un comité, un
              hogar. Después podrás vincular su nodo y su Telegram.
            </p>
            <NuevaComunidad />
          </section>
        ) : ruta === "agua" ? (
          <MiAgua alIr={ir} />
        ) : ruta === "reportes" ? (
          <Reportes />
        ) : (
          <Comunidad />
        )}
      </main>

      {comunidad && (
        <nav className="pestanas" aria-label="Secciones">
          {PESTANAS.map((p) => (
            <button
              key={p.ruta}
              type="button"
              className={p.ruta === ruta ? "pestana pestana-activa" : "pestana"}
              aria-current={p.ruta === ruta ? "page" : undefined}
              onClick={() => ir(p.ruta)}
            >
              <Icono nombre={p.icono} />
              <span>{p.texto}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
