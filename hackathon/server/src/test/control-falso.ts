import type { AccionDoc, AlmacenControl, EventoActuador } from "../modulos/control/index.ts";
import type { NodoDoc } from "../modulos/nodos/index.ts";

/** Almacén del control en memoria (con la misma semántica que Mongo: una acción viva por nodo, transiciones condicionales). */
export function crearAlmacenControlFalso(nodos: NodoDoc[]) {
  const acciones: AccionDoc[] = [];
  const eventos: EventoActuador[] = [];
  const viva = (a: AccionDoc) => a.estado === "pendiente" || a.estado === "en_curso";

  const almacen: AlmacenControl = {
    async guardarConfig(nodoId, config) {
      const n = nodos.find((x) => x._id.equals(nodoId));
      if (!n) return;
      if (config) n.actuador = config;
      else delete n.actuador;
    },
    async insertar(a) {
      if (acciones.some((x) => x.nodo_id.equals(a.nodo_id) && viva(x))) return "ocupado";
      acciones.push({ ...a });
      return "insertada";
    },
    async obtener(id, nodoId) {
      return acciones.find((a) => a._id.equals(id) && a.nodo_id.equals(nodoId)) ?? null;
    },
    async transicion(id, desde, cambios) {
      const a = acciones.find((x) => x._id.equals(id));
      if (!a || !desde.includes(a.estado)) return null;
      Object.assign(a, cambios);
      return { ...a };
    },
    async activa(nodoId) {
      return acciones.find((a) => a.nodo_id.equals(nodoId) && viva(a)) ?? null;
    },
    async ultimoFin(nodoId) {
      const fines = acciones
        .filter(
          (a) =>
            a.nodo_id.equals(nodoId) &&
            (a.estado === "terminada" || a.estado === "detenida") &&
            a.fin,
        )
        .map((a) => (a.fin as Date).getTime());
      return fines.length ? new Date(Math.max(...fines)) : null;
    },
    async recientes(nodoId, limite) {
      return acciones
        .filter((a) => a.nodo_id.equals(nodoId))
        .slice(-limite)
        .reverse();
    },
    async vencidas(t) {
      return acciones.filter(
        (a) =>
          (a.estado === "pendiente" && a.expira <= t) ||
          (a.estado === "en_curso" && a.fin !== null && a.fin <= t),
      );
    },
    async nodo(id) {
      return nodos.find((n) => n._id.equals(id)) ?? null;
    },
    async registrarEvento(e) {
      eventos.push(e);
    },
  };
  return { almacen, acciones, eventos };
}
