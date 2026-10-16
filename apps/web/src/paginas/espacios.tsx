import type { EspacioApi, TipoEspacio } from "@lympha/contracts";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { useAccionesEspacio, useAlarmas, useEspacios } from "../api/consultas.ts";
import { mensajeDeError } from "../api/mensajes.ts";
import { etiquetaRol, etiquetaTipo, TIPOS_ESPACIO } from "../componentes/etiquetas.ts";
import { IcoAdelante, IcoCampana, IcoMas } from "../componentes/Iconos.tsx";
import { ordenarPorUrgencia, ResumenEspacio } from "../componentes/ResumenEspacio.tsx";
import { AvisoFlujo, TarjetaNodo } from "../componentes/TarjetaNodo.tsx";
import { useAhora, useEstadoEspacio } from "../espacios/useEstadoEspacio.ts";

/** Un espacio con el semáforo en vivo de todos sus nodos (RF-22). */
function SeccionEspacio({ espacio }: { espacio: EspacioApi }) {
  const { detalle, nodos, flujo } = useEstadoEspacio(espacio.id);
  const abiertas = useAlarmas(espacio.id, "abiertas");
  const ahora = useAhora();
  const activas = abiertas.data?.alarmas.filter((a) => a.estado === "activa").length ?? 0;
  const atendidas = (abiertas.data?.alarmas.length ?? 0) - activas;
  return (
    <section className="espacio grid gap-3" aria-labelledby={`esp-${espacio.id}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id={`esp-${espacio.id}`} className="m-0">
            <Link
              to={`/espacios/${espacio.id}`}
              className="inline-flex min-h-11 items-center gap-1 text-text no-underline hover:underline"
            >
              {espacio.nombre}
              <IcoAdelante tamano={20} />
            </Link>
          </h2>
          <p className="detalle m-0">
            {etiquetaTipo(espacio.tipo)} · {etiquetaRol(espacio.rol)}
          </p>
        </div>
        {espacio.rol === "propietario" && nodos.length > 0 && (
          <Link to={`/espacios/${espacio.id}/reclamar`} className="boton-secundario">
            <IcoMas tamano={18} /> Reclamar un nodo
          </Link>
        )}
      </div>
      <AvisoFlujo flujo={flujo} />
      {activas + atendidas > 0 && (
        <p className="aviso-alertas m-0">
          <Link
            to="/alertas"
            className="inline-flex min-h-11 items-center gap-2 rounded-ctl bg-brand-soft px-3 font-bold text-brand-text no-underline"
          >
            <IcoCampana tamano={18} />
            {activas > 0
              ? `${activas === 1 ? "1 alerta activa" : `${activas} alertas activas`}`
              : `${atendidas === 1 ? "1 alerta atendida" : `${atendidas} alertas atendidas`}, sin resolver`}
          </Link>
        </p>
      )}
      {detalle.isError && <p role="alert">{mensajeDeError(detalle.error)}</p>}
      <ResumenEspacio nombre={espacio.nombre} nodos={nodos} />
      {detalle.data && nodos.length === 0 && (
        <div className="tarjeta grid justify-items-start gap-3 p-5">
          <p className="m-0">Todavía no hay nodos en este espacio.</p>
          {espacio.rol === "propietario" && (
            <Link to={`/espacios/${espacio.id}/reclamar`} className="boton">
              Reclamar un nodo
            </Link>
          )}
        </div>
      )}
      <div className="rejilla">
        {ordenarPorUrgencia(nodos).map((n) => (
          <TarjetaNodo key={n.id} nodo={n} ahora={ahora} />
        ))}
      </div>
    </section>
  );
}

/** Inicio: el estado de los nodos de cada espacio y el formulario para crear otro espacio. */
export function Espacios() {
  const espacios = useEspacios();
  const { crear } = useAccionesEspacio();
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<TipoEspacio>("hogar");

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    crear.mutate({ nombre: nombre.trim(), tipo }, { onSuccess: () => setNombre("") });
  }

  return (
    <main className="pagina grid gap-8">
      <h1>Tus espacios</h1>

      {espacios.isPending && <p role="status">Cargando…</p>}
      {espacios.isError && <p role="alert">{mensajeDeError(espacios.error)}</p>}
      {espacios.data && espacios.data.espacios.length === 0 && (
        <p className="tarjeta m-0 p-5">
          Aún no tienes espacios. Crea el primero, por ejemplo «Mi casa».
        </p>
      )}
      {espacios.data?.espacios.map((e) => (
        <SeccionEspacio key={e.id} espacio={e} />
      ))}

      <section className="tarjeta p-5">
        <h2 className="mb-3">Nuevo espacio</h2>
        <form onSubmit={enviar} className="m-0">
          <label>
            Nombre
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={80}
              placeholder="Mi casa"
              required
            />
          </label>
          <label>
            Tipo
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoEspacio)}>
              {TIPOS_ESPACIO.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.etiqueta}
                </option>
              ))}
            </select>
          </label>
          {crear.isError && <p role="alert">{mensajeDeError(crear.error)}</p>}
          <button type="submit" disabled={crear.isPending}>
            Crear espacio
          </button>
        </form>
      </section>
    </main>
  );
}
