import { type FormEvent, useState } from "react";
import { mensajeDeError } from "../api/mensajes.ts";
import {
  accion as esquemaAccion,
  estadoControl,
  type Nodo,
  respuestaDetener,
} from "../api/tipos.ts";
import { useConsulta } from "../api/use-consulta.ts";
import { Icono } from "../componentes/Iconos.tsx";
import { Aviso, Cargando, ErrorConReintento, useAhora } from "../componentes/Piezas.tsx";
import { useSesion } from "../sesion/contexto.tsx";
import { duracionCorta, fechaMx, segundosRestantes } from "../util/formato.ts";
import { describirAccion, estaViva } from "./dosificacion-calculo.ts";

/**
 * Tarjeta de dosificación de «Mi agua»: aparece solo si el nodo tiene un actuador habilitado. Atl **no** manda
 * dosificar por su cuenta: una persona responsable pide un pulso y otra (o la misma) lo confirma. Atl manda la
 * orden a Blynk; el relevador lo decide el firmware y Atl no ve si actuó, y así se lo dice a la gente.
 */
export function TarjetaDosificacion({ nodo }: { nodo: Nodo }) {
  const { api } = useSesion();
  const ruta = `/api/nodos/${nodo.id}/actuador`;
  const control = useConsulta(
    (signal) => api.pedir(ruta, { esquema: estadoControl, signal }),
    [api, nodo.id],
    // Se refresca seguido: un pulso cambia de estado en segundos (confirmado, en curso, terminado).
    { cadaMs: 3000, activa: nodo.actuador?.habilitado === true },
  );
  const [duracion, setDuracion] = useState(10);
  const [motivo, setMotivo] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ahora = useAhora();

  if (!nodo.actuador?.habilitado) return null;
  const responsable = nodo.rol === "responsable";
  const c = control.datos;
  const sim = nodo.actuador.simulado;

  async function hacer(tarea: () => Promise<unknown>) {
    setError(null);
    setTrabajando(true);
    try {
      await tarea();
      control.recargar();
    } catch (e) {
      setError(mensajeDeError(e));
      control.recargar();
    } finally {
      setTrabajando(false);
    }
  }

  const pedir = (e: FormEvent) => {
    e.preventDefault();
    void hacer(async () => {
      await api.pedir(`${ruta}/pulsos`, {
        metodo: "POST",
        cuerpo: { duracion_s: duracion, ...(motivo.trim() ? { motivo: motivo.trim() } : {}) },
        esquema: esquemaAccion,
      });
      setMotivo("");
    });
  };

  const activa = c?.activa ?? null;
  return (
    <section className="tarjeta tarjeta-dosis" aria-label="Dosificación">
      <div className="fila-titulo">
        <h2>
          <Icono nombre="gota" /> {nodo.actuador.nombre}
        </h2>
        {sim && <span className="sello-simulado">Simulado</span>}
      </div>
      <p className="nota">
        {sim
          ? "No hay un relevador real conectado: aquí se ensaya el flujo y todo queda rotulado como simulado. "
          : ""}
        Atl manda la orden a Blynk; el relevador lo decide el firmware y Atl no ve si actuó. Subir
        la dosis siempre lo confirma una persona.
      </p>

      {control.cargando && !c ? <Cargando texto="Leyendo el actuador…" /> : null}
      {control.error && !c ? (
        <ErrorConReintento error={control.error} alReintentar={control.recargar} />
      ) : null}
      {error && <Aviso tipo="error">{error}</Aviso>}

      {c && activa?.estado === "pendiente" && (
        <div className="aviso" role="status">
          <p>
            <strong>Pulso de {duracionCorta(activa.duracion_s)} pendiente.</strong> ¿Lo confirmas?
            Vence en {duracionCorta(segundosRestantes(activa.expira, ahora))}.
          </p>
          {activa.motivo && <p className="nota">Motivo: {activa.motivo}</p>}
          {responsable ? (
            <div className="acciones">
              <button
                type="button"
                className="boton boton-primario"
                disabled={trabajando}
                onClick={() =>
                  void hacer(() =>
                    api.pedir(`${ruta}/pulsos/${activa.id}/confirmar`, {
                      metodo: "POST",
                      esquema: esquemaAccion,
                    }),
                  )
                }
              >
                <Icono nombre="check" /> Confirmar el pulso
              </button>
              <button
                type="button"
                className="boton boton-secundario"
                disabled={trabajando}
                onClick={() =>
                  void hacer(() =>
                    api.pedir(`${ruta}/pulsos/${activa.id}/cancelar`, {
                      metodo: "POST",
                      esquema: esquemaAccion,
                    }),
                  )
                }
              >
                No, esperar
              </button>
            </div>
          ) : (
            <p className="nota">Solo quien es responsable puede confirmarlo.</p>
          )}
        </div>
      )}

      {c && activa?.estado === "en_curso" && (
        <div className="aviso" role="status">
          <p>
            <strong>Orden enviada: pulso de {duracionCorta(activa.duracion_s)}.</strong>{" "}
            {activa.fin
              ? `Se mandará apagar en ${duracionCorta(segundosRestantes(activa.fin, ahora))}.`
              : ""}
          </p>
          {responsable && (
            <button
              type="button"
              className="boton boton-secundario"
              disabled={trabajando}
              onClick={() =>
                void hacer(() =>
                  api.pedir(`${ruta}/detener`, { metodo: "POST", esquema: respuestaDetener }),
                )
              }
            >
              Detener ahora
            </button>
          )}
        </div>
      )}

      {c && !estaViva(activa) && (
        <>
          {c.bloqueos.length > 0 ? (
            <div className="aviso" role="status">
              <p>
                <strong>Ahora no se puede dosificar.</strong>
              </p>
              <ul className="lista-simple">
                {c.bloqueos.map((b) => (
                  <li key={b.codigo}>{b.mensaje}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {responsable ? (
            <form className="formulario" onSubmit={pedir}>
              <label>
                Duración del pulso (segundos)
                <input
                  type="number"
                  min={1}
                  max={c.actuador?.pulso_max_s ?? 30}
                  step={1}
                  value={duracion}
                  onChange={(e) => setDuracion(Number(e.target.value))}
                  required
                />
                <span className="nota">
                  Hasta {c.actuador?.pulso_max_s ?? 30} s. Después hay que esperar{" "}
                  {duracionCorta(c.actuador?.enfriamiento_s ?? 0)}.
                </span>
              </label>
              <label>
                Motivo (opcional)
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  maxLength={200}
                  placeholder="El cloro está bajo en la prueba de tiras"
                />
              </label>
              <button
                type="submit"
                className="boton boton-primario"
                disabled={trabajando || !c.puede_solicitar}
              >
                <Icono nombre="gota" /> Pedir un pulso
              </button>
              <p className="nota">Pedirlo no manda nada: queda esperando tu confirmación.</p>
            </form>
          ) : (
            <p className="nota">Solo quien es responsable puede pedir o confirmar un pulso.</p>
          )}
        </>
      )}

      {c && c.recientes.length > 0 && (
        <details>
          <summary>Historial reciente</summary>
          <ul className="lista">
            {c.recientes.slice(0, 5).map((a) => (
              <li key={a.id}>
                <strong>{describirAccion(a)}</strong>
                <span className="nota">
                  {fechaMx(a.solicitada)}
                  {a.detalle ? ` · ${a.detalle}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
