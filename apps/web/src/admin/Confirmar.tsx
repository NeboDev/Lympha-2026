import { useState } from "react";

/**
 * Acción destructiva con confirmación explícita: el primer botón solo abre el aviso; la acción real exige un
 * segundo clic en un botón que dice qué va a pasar. Nada se ejecuta con un solo toque.
 */
export function Confirmar({
  etiqueta,
  aviso,
  textoConfirmar,
  pendiente,
  error,
  alConfirmar,
}: {
  etiqueta: string;
  aviso: string;
  textoConfirmar: string;
  pendiente: boolean;
  error?: string | null;
  alConfirmar: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  if (!abierto) {
    return (
      <button type="button" className="peligro justify-self-start" onClick={() => setAbierto(true)}>
        {etiqueta}
      </button>
    );
  }
  return (
    <div role="alertdialog" aria-label={etiqueta} className="tarjeta grid gap-3 p-4">
      <p className="m-0 font-semibold">{aviso}</p>
      {error && (
        <p role="alert" className="m-0">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="peligro" disabled={pendiente} onClick={alConfirmar}>
          {pendiente ? "Procesando…" : textoConfirmar}
        </button>
        <button
          type="button"
          className="secundario"
          disabled={pendiente}
          onClick={() => setAbierto(false)}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
