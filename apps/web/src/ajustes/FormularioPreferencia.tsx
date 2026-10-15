import type { PreferenciaNotificacion, SeveridadAlarma } from "@lympha/contracts";
import { type FormEvent, useEffect, useState } from "react";
import {
  aBorrador,
  type BorradorPreferencia,
  dePreferencia,
  NIVELES_ELEGIBLES,
} from "./preferencias.ts";

const zonasConocidas = (): string[] => {
  try {
    return (
      (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ??
      []
    );
  } catch {
    return [];
  }
};

/**
 * Formulario de una preferencia de aviso (RF-31): niveles, horario silencioso, zona horaria y recordatorio. Sirve
 * para los ajustes generales (`nodoId` nulo) y para los de un nodo.
 */
export function FormularioPreferencia({
  valor,
  nodoId,
  textoGuardar,
  ocupado,
  errorDelServidor,
  alGuardar,
  alCancelar,
}: {
  valor: PreferenciaNotificacion;
  nodoId: string | null;
  textoGuardar: string;
  ocupado: boolean;
  errorDelServidor: string | null;
  alGuardar: (p: PreferenciaNotificacion) => void;
  alCancelar?: () => void;
}) {
  const [b, setB] = useState<BorradorPreferencia>(() => aBorrador(valor));
  const [error, setError] = useState<string | null>(null);
  const idLista = `zonas-${nodoId ?? "general"}`;

  // Si la preferencia cambia en el servidor (otra pestaña, otro dispositivo) el formulario la sigue; una nueva
  // consulta con los mismos datos no borra lo que la persona está escribiendo.
  const huella = JSON.stringify(valor);
  // (solo `huella` decide cuándo se reinicia el borrador: por eso `valor` no está en las dependencias)
  useEffect(() => setB(aBorrador(valor)), [huella]);

  const alternarNivel = (nivel: SeveridadAlarma, activo: boolean) =>
    setB((previo) => ({
      ...previo,
      niveles: activo ? [...previo.niveles, nivel] : previo.niveles.filter((n) => n !== nivel),
    }));

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    const r = dePreferencia(b, nodoId);
    if (!r.ok) return setError(r.error);
    setError(null);
    alGuardar(r.preferencia);
  }

  return (
    <form onSubmit={enviar} className="preferencia">
      <fieldset>
        <legend>Avisarme cuando la calidad del agua sea</legend>
        {NIVELES_ELEGIBLES.map((n) => (
          <label key={n.valor} className="interruptor">
            <input
              type="checkbox"
              checked={b.niveles.includes(n.valor)}
              onChange={(e) => alternarNivel(n.valor, e.target.checked)}
            />
            {n.etiqueta}
          </label>
        ))}
        <p className="detalle">
          Los avisos de un nodo sin conexión o con un sensor por revisar llegan siempre.
        </p>
      </fieldset>

      <fieldset>
        <legend>Horario silencioso</legend>
        <label className="interruptor">
          <input
            type="checkbox"
            checked={b.silencioActivo}
            onChange={(e) => setB({ ...b, silencioActivo: e.target.checked })}
          />
          No avisarme durante un horario
        </label>
        {b.silencioActivo && (
          <div className="horario">
            <label>
              Desde
              <input
                type="time"
                value={b.silencioInicio}
                onChange={(e) => setB({ ...b, silencioInicio: e.target.value })}
              />
            </label>
            <label>
              Hasta
              <input
                type="time"
                value={b.silencioFin}
                onChange={(e) => setB({ ...b, silencioFin: e.target.value })}
              />
            </label>
          </div>
        )}
        <p className="detalle">
          Los avisos de ese horario no se pierden: llegan juntos al terminar, también los críticos.
        </p>
      </fieldset>

      <label>
        Zona horaria
        <input
          list={idLista}
          value={b.zonaHoraria}
          onChange={(e) => setB({ ...b, zonaHoraria: e.target.value })}
          autoComplete="off"
          spellCheck={false}
        />
        <datalist id={idLista}>
          {zonasConocidas().map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
      </label>

      <label>
        Recordarme cada (horas) mientras el problema siga
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={72}
          value={b.recordatorioH}
          onChange={(e) => setB({ ...b, recordatorioH: e.target.value })}
        />
      </label>

      {(error ?? errorDelServidor) && <p role="alert">{error ?? errorDelServidor}</p>}
      <div className="acciones">
        <button type="submit" disabled={ocupado}>
          {textoGuardar}
        </button>
        {alCancelar && (
          <button type="button" className="secundario" onClick={alCancelar}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
