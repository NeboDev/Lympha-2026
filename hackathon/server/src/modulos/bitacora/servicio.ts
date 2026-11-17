import type { ObjectId } from "mongodb";
import { SolicitudInvalida } from "../../dominio/errores.ts";
import type { ServicioNodos } from "../nodos/index.ts";

/** Una nota humana del nodo («se lavó el tinaco»): entra al reporte en «Bitácora de la comunidad». */
export type EventoBitacora = {
  nodo_id: ObjectId;
  comunidad_id: ObjectId;
  ts: Date;
  tipo: "bitacora";
  severidad: "info";
  parametro: null;
  mensaje: string;
  datos: Record<string, never>;
  autor_uid: string;
};

export interface AlmacenBitacora {
  registrar(evento: EventoBitacora): Promise<void>;
}

export const TEXTO_MAX = 500;

export type OpcionesBitacora = {
  almacen: AlmacenBitacora;
  nodos: Pick<ServicioNodos, "acceso">;
  reloj?: () => Date;
};

/** Quita caracteres de control (salvo el salto de línea) y recorta espacios en los extremos. */
export function limpiarTexto(t: string): string {
  return (
    t
      .replace(/\r\n?/g, "\n")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: justo se trata de quitarlos
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
      .trim()
  );
}

export function crearServicioBitacora(op: OpcionesBitacora) {
  const reloj = op.reloj ?? (() => new Date());
  return {
    /** Cualquier miembro de la comunidad puede anotar. */
    async anotar(
      uid: string,
      nodoId: ObjectId,
      texto: string,
    ): Promise<{ ts: Date; texto: string }> {
      const { nodo } = await op.nodos.acceso(uid, nodoId, "integrante");
      const limpio = limpiarTexto(texto);
      if (limpio.length === 0 || limpio.length > TEXTO_MAX) {
        throw new SolicitudInvalida(
          "texto_invalido",
          `La nota debe tener de 1 a ${TEXTO_MAX} caracteres.`,
        );
      }
      const ts = reloj();
      await op.almacen.registrar({
        nodo_id: nodo._id,
        comunidad_id: nodo.comunidad_id,
        ts,
        tipo: "bitacora",
        severidad: "info",
        parametro: null,
        mensaje: limpio,
        datos: {},
        autor_uid: uid,
      });
      return { ts, texto: limpio };
    },
  };
}

export type ServicioBitacora = ReturnType<typeof crearServicioBitacora>;
