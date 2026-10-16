import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAccionesEspacio } from "../api/consultas.ts";
import { mensajeDeError } from "../api/mensajes.ts";
import { IcoAtras, IcoCamara } from "../componentes/Iconos.tsx";
import { interpretarReclamo } from "../nodos/codigo-qr.ts";
import { EscanerQr, escaneoDisponible } from "../nodos/EscanerQr.tsx";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reclamar un nodo con la etiqueta: QR (si el navegador lo permite) o identificador y código escritos. */
export function Reclamar() {
  const { espacioId = "" } = useParams();
  const navegar = useNavigate();
  const { reclamarNodo } = useAccionesEspacio();
  const [nodoId, setNodoId] = useState("");
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [escaneando, setEscaneando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  function alLeerQr(texto: string) {
    setEscaneando(false);
    const datos = interpretarReclamo(texto);
    if (!datos) {
      setAviso("Ese QR no es de un nodo de Lympha. Prueba de nuevo o escribe los datos a mano.");
      return;
    }
    setAviso(null);
    setNodoId(datos.nodoId);
    setCodigo(datos.codigo);
  }

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    // el identificador y el código pueden pegarse juntos en cualquiera de los dos campos
    const pegado = interpretarReclamo(`${nodoId} ${codigo}`);
    const datos = pegado ?? { nodoId: nodoId.trim(), codigo: codigo.trim() };
    setAviso(null);
    reclamarNodo.mutate(
      {
        espacioId,
        nodoId: datos.nodoId,
        codigo: datos.codigo,
        ...(nombre.trim() ? { nombre: nombre.trim() } : {}),
      },
      { onSuccess: () => navegar(`/espacios/${espacioId}`, { replace: true }) },
    );
  }

  return (
    <main className="pagina grid max-w-xl gap-5">
      <Link to={`/espacios/${espacioId}`} className="volver">
        <IcoAtras tamano={20} /> Volver al espacio
      </Link>
      <header className="grid gap-1">
        <h1 className="m-0">Reclamar un nodo</h1>
        <p className="m-0 text-text-2">
          Usa la etiqueta del nodo: escanea su QR o escribe el identificador y el código.
        </p>
      </header>

      {escaneando ? (
        <EscanerQr alLeer={alLeerQr} alCerrar={() => setEscaneando(false)} />
      ) : (
        escaneoDisponible() && (
          <button type="button" className="justify-self-start" onClick={() => setEscaneando(true)}>
            <IcoCamara tamano={20} /> Escanear el QR
          </button>
        )
      )}
      {aviso && <p role="alert">{aviso}</p>}

      <form onSubmit={enviar} className="tarjeta m-0 p-5">
        <label>
          Identificador del nodo
          <input
            value={nodoId}
            onChange={(e) => setNodoId(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="0192f3a7-…"
            required
          />
        </label>
        <label>
          Código de la etiqueta
          <input
            className="codigo"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="ABCD-EFGH-JKMN"
          />
        </label>
        <label>
          Nombre del nodo (opcional)
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            maxLength={60}
            placeholder="Cisterna del patio"
          />
        </label>
        {reclamarNodo.isError && <p role="alert">{mensajeDeError(reclamarNodo.error)}</p>}
        <button
          type="submit"
          disabled={
            reclamarNodo.isPending ||
            !(
              interpretarReclamo(`${nodoId} ${codigo}`) ||
              (UUID.test(nodoId.trim()) && codigo.trim() !== "")
            )
          }
        >
          Reclamar nodo
        </button>
      </form>
    </main>
  );
}
