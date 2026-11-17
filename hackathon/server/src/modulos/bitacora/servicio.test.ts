import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { NoEncontrado, SinPermiso, SolicitudInvalida } from "../../dominio/errores.ts";
import { nodoDePrueba } from "../../test/falsos.ts";
import type { NodoDoc, ServicioNodos } from "../nodos/index.ts";
import { crearServicioBitacora, type EventoBitacora, limpiarTexto, TEXTO_MAX } from "./index.ts";

function escenario(rolDe: Record<string, "responsable" | "integrante"> = { ana: "integrante" }) {
  const nodo: NodoDoc = nodoDePrueba(new ObjectId(), "Tinaco azotea");
  const eventos: EventoBitacora[] = [];
  const nodos: Pick<ServicioNodos, "acceso"> = {
    async acceso(uid, id) {
      const rol = rolDe[uid];
      if (!id.equals(nodo._id) || !rol) throw new NoEncontrado();
      return { nodo, rol, comunidad: {} as never };
    },
  };
  const servicio = crearServicioBitacora({
    almacen: {
      async registrar(e) {
        eventos.push(e);
      },
    },
    nodos,
    reloj: () => new Date(1000),
  });
  return { nodo, eventos, servicio };
}

describe("anotar", () => {
  it("un integrante puede anotar: queda como evento «bitacora» con su autor", async () => {
    const e = escenario();
    const r = await e.servicio.anotar("ana", e.nodo._id, "  Se lavó el tinaco.  ");
    expect(r).toEqual({ ts: new Date(1000), texto: "Se lavó el tinaco." });
    expect(e.eventos).toEqual([
      {
        nodo_id: e.nodo._id,
        comunidad_id: e.nodo.comunidad_id,
        ts: new Date(1000),
        tipo: "bitacora",
        severidad: "info",
        parametro: null,
        mensaje: "Se lavó el tinaco.",
        datos: {},
        autor_uid: "ana",
      },
    ]);
  });

  it("un nodo ajeno da NoEncontrado y no escribe nada", async () => {
    const e = escenario();
    await expect(e.servicio.anotar("intruso", e.nodo._id, "hola")).rejects.toBeInstanceOf(
      NoEncontrado,
    );
    await expect(e.servicio.anotar("ana", new ObjectId(), "hola")).rejects.toBeInstanceOf(
      NoEncontrado,
    );
    expect(e.eventos).toHaveLength(0);
  });

  it.each(["", "   ", "\n\t\n", "x".repeat(TEXTO_MAX + 1)])("rechaza la nota %j", async (texto) => {
    const e = escenario();
    await expect(e.servicio.anotar("ana", e.nodo._id, texto)).rejects.toBeInstanceOf(
      SolicitudInvalida,
    );
    expect(e.eventos).toHaveLength(0);
  });

  it("acepta una nota del largo máximo exacto", async () => {
    const e = escenario();
    await e.servicio.anotar("ana", e.nodo._id, "x".repeat(TEXTO_MAX));
    expect(e.eventos).toHaveLength(1);
  });

  it("si el servicio de nodos niega el permiso, el error se propaga", async () => {
    const e = escenario();
    const servicio = crearServicioBitacora({
      almacen: { async registrar() {} },
      nodos: {
        async acceso() {
          throw new SinPermiso();
        },
      },
    });
    await expect(servicio.anotar("x", e.nodo._id, "hola")).rejects.toBeInstanceOf(SinPermiso);
  });
});

describe("limpiarTexto", () => {
  it("conserva acentos, ñ y saltos de línea; quita los caracteres de control", () => {
    expect(limpiarTexto("Año nuevo\r\nlínea 2\u0000\u0007")).toBe("Año nuevo\nlínea 2");
    expect(limpiarTexto("\u001b[31mrojo")).toBe("[31mrojo");
  });
});
