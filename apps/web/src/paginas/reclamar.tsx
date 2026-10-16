import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAccionesEspacio } from "../api/consultas.ts";
import { mensajeDeError } from "../api/mensajes.ts";
import { IcoAtras, IcoCamara, IcoCheck, IcoQr } from "../componentes/Iconos.tsx";
import { interpretarReclamo } from "../nodos/codigo-qr.ts";
import { EscanerQr, escaneoDisponible } from "../nodos/EscanerQr.tsx";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUGERENCIAS = ["Cisterna del patio", "Tinaco", "Llave de la cocina"];

/** Barra de progreso de dos pasos, como la del asistente de alta del diseño. */
function Progreso({ paso }: { paso: 1 | 2 }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex flex-1 gap-1.5"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={2}
        aria-valuenow={paso}
        aria-label={`Paso ${paso} de 2`}
      >
        {[1, 2].map((n) => (
          <span
            key={n}
            className={`h-1.5 flex-1 rounded-full transition-colors ${n <= paso ? "bg-brand" : "bg-line-strong"}`}
          />
        ))}
      </div>
      <span className="text-sm font-bold text-text-2 tabular-nums">Paso {paso} de 2</span>
    </div>
  );
}

/** Visor con esquinas y línea de escaneo. Solo la cámara real lo anima: nunca finge haber leído un código. */
function Visor({ activo, children }: { activo: boolean; children?: React.ReactNode }) {
  return (
    <div className={`visor${activo ? " activo" : ""}`}>
      {children ?? (
        <span className="grid justify-items-center gap-2 text-text-2" aria-hidden="true">
          <IcoQr tamano={72} grosor={1.4} />
        </span>
      )}
      <span className="esquina tl" />
      <span className="esquina tr" />
      <span className="esquina bl" />
      <span className="esquina br" />
      {activo && <span className="linea" />}
    </div>
  );
}

/** Reclamar un nodo con la etiqueta: QR (si el navegador lo permite) o identificador y código escritos, y su nombre. */
export function Reclamar() {
  const { espacioId = "" } = useParams();
  const navegar = useNavigate();
  const { reclamarNodo } = useAccionesEspacio();
  const [paso, setPaso] = useState<1 | 2>(1);
  const [nodoId, setNodoId] = useState("");
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [escaneando, setEscaneando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const puedeEscanear = escaneoDisponible();

  const datosValidos = Boolean(
    interpretarReclamo(`${nodoId} ${codigo}`) || (UUID.test(nodoId.trim()) && codigo.trim() !== ""),
  );
  const encontrado = interpretarReclamo(`${nodoId} ${codigo}`);

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

  function continuar(evento: FormEvent) {
    evento.preventDefault();
    if (datosValidos) setPaso(2);
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
      <Progreso paso={paso} />

      {paso === 1 ? (
        <>
          <header className="grid gap-1">
            <h1 className="m-0">Escanea el código del nodo</h1>
            <p className="m-0 text-text-2">
              Lo encuentras en la etiqueta de la caja o en el costado del dispositivo.
            </p>
          </header>

          <Visor activo={escaneando}>
            {escaneando ? (
              <EscanerQr alLeer={alLeerQr} alCerrar={() => setEscaneando(false)} />
            ) : undefined}
          </Visor>

          <div role="status" className="min-h-6 text-center text-sm font-semibold">
            {encontrado ? (
              <span className="inline-flex items-center gap-1.5">
                <IcoCheck tamano={18} grosor={3} /> Código del nodo listo
              </span>
            ) : escaneando ? (
              <span className="text-text-2">Apunta la cámara al código…</span>
            ) : !puedeEscanear ? (
              <span className="text-text-2">
                Este navegador no puede leer códigos QR. Escribe los datos de la etiqueta.
              </span>
            ) : null}
          </div>
          {aviso && <p role="alert">{aviso}</p>}

          {puedeEscanear && !escaneando && (
            <button type="button" className="secundario" onClick={() => setEscaneando(true)}>
              <IcoCamara tamano={20} /> Escanear el QR
            </button>
          )}

          <form onSubmit={continuar} className="tarjeta m-0 p-5">
            <p className="m-0 text-sm font-bold text-text-2">
              {puedeEscanear ? "O escribe los datos de la etiqueta" : "Datos de la etiqueta"}
            </p>
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
            <button type="submit" disabled={!datosValidos}>
              Continuar
            </button>
          </form>
        </>
      ) : (
        <>
          <header className="grid gap-1">
            <h1 className="m-0">Ponle un nombre</h1>
            <p className="m-0 text-text-2">
              Elige uno que reconozcas al ver una alerta en Telegram. Es opcional.
            </p>
          </header>
          <form onSubmit={enviar} className="tarjeta m-0 p-5">
            <label>
              Nombre del nodo (opcional)
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                maxLength={60}
                placeholder="Cisterna del patio"
                autoComplete="off"
              />
            </label>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Sugerencias de nombre">
              {SUGERENCIAS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="pill"
                  aria-pressed={nombre === s}
                  onClick={() => setNombre(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            {reclamarNodo.isError && <p role="alert">{mensajeDeError(reclamarNodo.error)}</p>}
            <button type="submit" disabled={reclamarNodo.isPending}>
              Reclamar nodo
            </button>
            <button type="button" className="enlace" onClick={() => setPaso(1)}>
              Volver al paso 1
            </button>
          </form>
        </>
      )}
    </main>
  );
}
