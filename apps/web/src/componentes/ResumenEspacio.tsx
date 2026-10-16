import type { EstadoVisible, NodoVista } from "../espacios/estado.ts";
import { ICONO_ESTADO } from "./estados.tsx";
import { IcoCirculoCheck } from "./Iconos.tsx";

/** Del más urgente al menos: lo que más importa va primero en el resumen y en la rejilla. */
const URGENCIA: EstadoVisible[] = [
  "critica",
  "mala",
  "sin_conexion",
  "revisar",
  "sin_datos",
  "regular",
  "esperando",
  "sin_vincular",
  "deshabilitado",
  "buena",
];

const NOMBRE: Record<EstadoVisible, string> = {
  critica: "Crítica",
  mala: "Mala",
  sin_conexion: "Sin conexión",
  revisar: "Revisar sensor",
  sin_datos: "Sin datos",
  regular: "Regular",
  esperando: "Esperando lectura",
  sin_vincular: "Sin vincular",
  deshabilitado: "Deshabilitado",
  buena: "Buena",
};

export const ordenarPorUrgencia = (nodos: NodoVista[]): NodoVista[] =>
  [...nodos].sort((a, b) => URGENCIA.indexOf(a.visible) - URGENCIA.indexOf(b.visible));

/**
 * Resumen de un espacio, calculado solo con los estados que ya se muestran en sus tarjetas: cuántos nodos piden
 * atención y de qué tipo. «Todo en orden» solo si todos los nodos tienen nivel Buena (no afirma nada del agua más allá).
 */
export function ResumenEspacio({ nombre, nodos }: { nombre: string; nodos: NodoVista[] }) {
  if (nodos.length === 0) return null;
  const cuenta = new Map<EstadoVisible, number>();
  for (const n of nodos) cuenta.set(n.visible, (cuenta.get(n.visible) ?? 0) + 1);
  const esperando = cuenta.get("esperando") ?? 0;
  // un nodo que aún no manda su primera lectura no es un problema: no cuenta como «pide atención»
  const atencion = nodos.filter((n) => n.visible !== "buena" && n.visible !== "esperando").length;

  if (atencion === 0 && esperando > 0) {
    return (
      <section
        aria-label={`Resumen de ${nombre}`}
        aria-live="polite"
        className="nivel-esperando rounded-card border border-line bg-[linear-gradient(135deg,var(--tinte),var(--surface))] p-4"
      >
        <p className="m-0 font-bold">
          {esperando === 1
            ? "Un nodo espera su primera lectura"
            : `${esperando} nodos esperan su primera lectura`}
        </p>
        <p className="m-0 mt-1 text-text-2">En cuanto el nodo mande datos verás aquí su estado.</p>
      </section>
    );
  }

  if (atencion === 0) {
    return (
      <section
        aria-label={`Resumen de ${nombre}`}
        aria-live="polite"
        className="nivel-buena rounded-card border border-line bg-[linear-gradient(135deg,var(--tinte),var(--surface))] p-4"
      >
        <p className="m-0 inline-flex items-center gap-2 text-sm font-bold text-text">
          <IcoCirculoCheck tamano={18} /> Todo en orden
        </p>
        <p className="m-0 mt-1 text-text-2">
          {nodos.length === 1
            ? "Tu nodo reporta el agua en nivel Buena."
            : `Los ${nodos.length} nodos reportan el agua en nivel Buena.`}{" "}
          Te avisamos por Telegram si algo cambia.
        </p>
      </section>
    );
  }

  const peor = URGENCIA.find((e) => e !== "buena" && cuenta.has(e)) ?? "regular";
  return (
    <section
      aria-label={`Resumen de ${nombre}`}
      aria-live="polite"
      className={`nivel-${peor} rounded-card border border-line bg-[linear-gradient(135deg,var(--tinte),var(--surface))] p-4`}
    >
      <p className="m-0 text-lg font-bold">
        {atencion === 1
          ? "1 nodo pide tu atención"
          : `${atencion} de ${nodos.length} nodos piden tu atención`}
      </p>
      <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm">
        {URGENCIA.filter((e) => cuenta.has(e)).map((e) => {
          const Icono = ICONO_ESTADO[e];
          return (
            <li key={e} className={`nivel-${e} inline-flex items-center gap-1.5`}>
              <span className="grid size-5 place-items-center rounded-md bg-(--fondo) text-on-state">
                <Icono tamano={12} grosor={3} />
              </span>
              <strong className="tabular-nums">{cuenta.get(e)}</strong> {NOMBRE[e]}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
