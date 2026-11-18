import { type FormEvent, useEffect, useState } from "react";
import { mensajeDeError } from "../api/mensajes.ts";
import { estadoControl, type Nodo } from "../api/tipos.ts";
import { useConsulta } from "../api/use-consulta.ts";
import { Aviso, Cargando, ErrorConReintento } from "../componentes/Piezas.tsx";
import { useEspacio } from "../espacio.tsx";
import { useSesion } from "../sesion/contexto.tsx";

/** Ajustes del actuador de un nodo (solo quien es responsable): habilitarlo, su nombre, límites y si es simulado. */
export function AjustesActuador({ nodo }: { nodo: Nodo }) {
  const { api } = useSesion();
  const { recargar } = useEspacio();
  const ruta = `/api/nodos/${nodo.id}/actuador`;
  const estado = useConsulta(
    (signal) => api.pedir(ruta, { esquema: estadoControl, signal }),
    [api, nodo.id],
  );

  const [habilitado, setHabilitado] = useState(false);
  const [nombre, setNombre] = useState("Bomba de cloro");
  const [pulsoMax, setPulsoMax] = useState(30);
  const [enfriamiento, setEnfriamiento] = useState(300);
  const [simulado, setSimulado] = useState(true);
  const [autoDetener, setAutoDetener] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);

  // Al llegar la configuración guardada, el formulario parte de ella.
  const actuador = estado.datos?.actuador ?? null;
  useEffect(() => {
    if (!actuador) return;
    setHabilitado(actuador.habilitado);
    setNombre(actuador.nombre);
    setPulsoMax(actuador.pulso_max_s);
    setEnfriamiento(actuador.enfriamiento_s);
    setSimulado(actuador.simulado);
    setAutoDetener(actuador.auto_detener);
  }, [actuador]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setListo(null);
    setGuardando(true);
    try {
      await api.pedir(ruta, {
        metodo: "PUT",
        cuerpo: {
          habilitado,
          nombre: nombre.trim(),
          pulso_max_s: pulsoMax,
          enfriamiento_s: enfriamiento,
          simulado,
          auto_detener: autoDetener,
        },
        esquema: estadoControl,
      });
      setListo(
        habilitado ? "Actuador guardado. «Mi agua» ya muestra los controles." : "Actuador apagado.",
      );
      estado.recargar();
      recargar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <details className="ajustes-actuador">
      <summary>Actuador de «{nodo.nombre}» (bomba o válvula)</summary>
      {estado.cargando && !estado.datos ? <Cargando /> : null}
      {estado.error && !estado.datos ? (
        <ErrorConReintento error={estado.error} alReintentar={estado.recargar} />
      ) : null}
      <form className="formulario" onSubmit={guardar}>
        <label className="casilla">
          <input
            type="checkbox"
            checked={habilitado}
            onChange={(e) => setHabilitado(e.target.checked)}
          />
          Este nodo tiene un actuador que Atl puede controlar
        </label>
        <label>
          ¿Cómo se llama?
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            minLength={2}
            maxLength={40}
            required
          />
        </label>
        <label>
          Pulso máximo (segundos)
          <input
            type="number"
            min={1}
            max={120}
            step={1}
            value={pulsoMax}
            onChange={(e) => setPulsoMax(Number(e.target.value))}
            required
          />
        </label>
        <label>
          Espera entre pulsos (segundos)
          <input
            type="number"
            min={0}
            max={3600}
            step={1}
            value={enfriamiento}
            onChange={(e) => setEnfriamiento(Number(e.target.value))}
            required
          />
        </label>
        <label className="casilla">
          <input
            type="checkbox"
            checked={simulado}
            onChange={(e) => setSimulado(e.target.checked)}
          />
          Es simulado: no hay un relevador real conectado
        </label>
        <label className="casilla">
          <input
            type="checkbox"
            checked={autoDetener}
            onChange={(e) => setAutoDetener(e.target.checked)}
          />
          Detener un pulso solo si el pH sale de rango, la sonda falla o el nodo deja de enviar
          datos
        </label>
        <p className="nota">
          Los límites de seguridad de verdad (pulso máximo, apagado sin datos) los decide el
          firmware. Esto es una segunda red encima, no un reemplazo. Atl solo manda la orden: no
          puede ver si el relevador actuó.
        </p>
        {error && <Aviso tipo="error">{error}</Aviso>}
        {listo && <Aviso>{listo}</Aviso>}
        <button type="submit" className="boton boton-secundario" disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar actuador"}
        </button>
      </form>
    </details>
  );
}
