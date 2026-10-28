import { useEffect, useState } from "react";
import { useAccionesTelegram, useTelegram } from "../api/consultas.ts";
import { mensajeDeError } from "../api/mensajes.ts";
import { IcoCheck, IcoEnviar, IcoX } from "../componentes/Iconos.tsx";

/** Solo se enlaza a Telegram: el enlace viene de la API, pero se revisa antes de ponerlo en un `href`. */
const esEnlaceDeTelegram = (url: string) => url.startsWith("https://t.me/");

/**
 * Vincular Telegram (RF-26): se pide un enlace de un solo uso, la persona lo abre en Telegram y pulsa «Iniciar»; la
 * PWA pregunta cada 3 s hasta que el vínculo exista (o el enlace venza, a los 10 min).
 */
export function SeccionTelegram() {
  const [enlace, setEnlace] = useState<{ url: string; expiraEn: number } | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const vigente = enlace !== null && ahora < enlace.expiraEn;
  const telegram = useTelegram(vigente);
  const { vincular, desvincular } = useAccionesTelegram();
  const vinculado = telegram.data?.vinculado === true;

  // el reloj solo corre mientras hay un enlace vigente, para detectar cuándo vence
  useEffect(() => {
    if (!vigente) return;
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [vigente]);

  // al quedar vinculado, el enlace ya no sirve
  useEffect(() => {
    if (vinculado) setEnlace(null);
  }, [vinculado]);

  const vencido = enlace !== null && !vigente && !vinculado;

  return (
    <section className="tarjeta grid gap-3 p-5" aria-labelledby="h-telegram">
      <div className="flex items-center gap-3">
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-full ${vinculado ? "bg-(--good-soft) text-text" : "bg-surface-2 text-text-2"}`}
          aria-hidden="true"
        >
          {vinculado ? <IcoCheck tamano={22} grosor={2.6} /> : <IcoEnviar tamano={22} />}
        </span>
        <h2 id="h-telegram" className="m-0">
          Telegram
        </h2>
      </div>
      {telegram.isPending && <p role="status">Cargando…</p>}
      {telegram.isError && <p role="alert">{mensajeDeError(telegram.error)}</p>}

      {vinculado && telegram.data && (
        <>
          <p>
            Telegram está vinculado
            {telegram.data.vinculado_en
              ? ` desde el ${new Date(telegram.data.vinculado_en).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}`
              : ""}
            . Los avisos de tus espacios llegan al chat con el bot.
          </p>
          <button
            type="button"
            className="secundario peligro justify-self-start"
            disabled={desvincular.isPending}
            onClick={() => {
              if (window.confirm("¿Desvincular Telegram? Dejarás de recibir avisos por ahí.")) {
                desvincular.mutate();
              }
            }}
          >
            <IcoX tamano={18} /> Desvincular Telegram
          </button>
          {desvincular.isError && <p role="alert">{mensajeDeError(desvincular.error)}</p>}
        </>
      )}

      {telegram.data && !vinculado && (
        <>
          <p>
            Vincula Telegram para recibir avisos cuando el agua cambie de nivel o un nodo se
            desconecte.
          </p>
          {!vigente && (
            <button
              type="button"
              className="justify-self-start"
              disabled={vincular.isPending}
              onClick={() =>
                vincular.mutate(undefined, {
                  onSuccess: (r) => {
                    setAhora(Date.now());
                    setEnlace({ url: r.enlace, expiraEn: Date.parse(r.expira_en) });
                  },
                })
              }
            >
              {vencido ? "Pedir otro enlace" : "Vincular Telegram"}
            </button>
          )}
          {vincular.isError && <p role="alert">{mensajeDeError(vincular.error)}</p>}
          {vencido && <p role="alert">El enlace venció. Pide uno nuevo.</p>}
          {vigente && enlace && (
            <div className="invitacion grid gap-2 rounded-ctl bg-surface-2 p-3">
              {esEnlaceDeTelegram(enlace.url) ? (
                <a
                  className="boton justify-self-start"
                  href={enlace.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <IcoEnviar tamano={18} /> Abrir Telegram
                </a>
              ) : (
                <p role="alert">No pudimos preparar el enlace. Inténtalo de nuevo.</p>
              )}
              <p role="status">
                En Telegram pulsa «Iniciar». Esperando a que lo confirmes… (el enlace vence a las{" "}
                {new Date(enlace.expiraEn).toLocaleTimeString("es-MX", {
                  hour: "numeric",
                  minute: "2-digit",
                })}
                )
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
