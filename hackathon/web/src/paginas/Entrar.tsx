import { useState } from "react";
import { Aviso, Marca } from "../componentes/Piezas.tsx";
import { CONFIG } from "../config.ts";
import { useSesion } from "../sesion/contexto.tsx";

/** Pantalla 1: Entrar. Logo, frase, botón de Google y la aclaración de que Atl no certifica el agua. */
export function Entrar() {
  const sesion = useSesion();
  const [error, setError] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  async function conGoogle() {
    setError(null);
    setEntrando(true);
    const problema = await sesion.entrarConGoogle();
    setEntrando(false);
    if (problema) setError(problema);
  }

  return (
    <main className="entrar">
      <div className="entrar-marca">
        <Marca tamano={72} />
        <h1>Atl</h1>
        <p className="lead">El agua de tu comunidad, a la vista de todos.</p>
      </div>

      {CONFIG.problemas.length > 0 && (
        <Aviso tipo="error">
          Falta configurar la web: {CONFIG.problemas.join(", ")}. Llena esas variables en{" "}
          <code>web/.env</code> y reinicia <code>pnpm dev</code>.
        </Aviso>
      )}
      {error && <Aviso tipo="error">{error}</Aviso>}
      {sesion.motivo && <Aviso tipo="error">{sesion.motivo}</Aviso>}

      <div className="entrar-acciones">
        <button
          type="button"
          className="boton boton-primario"
          onClick={conGoogle}
          disabled={!sesion.puedeGoogle || entrando}
        >
          {entrando ? "Abriendo Google…" : "Entrar con Google"}
        </button>
        {sesion.puedeDemo && (
          <button type="button" className="boton boton-secundario" onClick={sesion.entrarDemo}>
            Entrar como demostración
          </button>
        )}
      </div>

      <p className="nota">Atl no certifica el agua; te ayuda a vigilarla y a documentarla.</p>
    </main>
  );
}
