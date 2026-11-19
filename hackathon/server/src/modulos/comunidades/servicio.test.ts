import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { Conflicto, NoEncontrado, SinPermiso, SolicitudInvalida } from "../../dominio/errores.ts";
import {
  type AlmacenComunidades,
  type ComunidadDoc,
  crearServicioComunidades,
  MAX_COMUNIDADES_RESPONSABLE,
} from "./index.ts";

function escenario() {
  const docs: ComunidadDoc[] = [];
  const almacen: AlmacenComunidades = {
    async insertar(c) {
      docs.push(c);
    },
    async obtener(id) {
      return docs.find((c) => c._id.equals(id)) ?? null;
    },
    async deUsuario(uid) {
      return docs.filter((c) => c.miembros.some((m) => m.uid === uid));
    },
    async contarResponsable(uid) {
      return docs.filter((c) => c.miembros.some((m) => m.uid === uid && m.rol === "responsable"))
        .length;
    },
    async desvincularTelegram(id) {
      const c = docs.find((x) => x._id.equals(id));
      if (c) c.telegram = null;
    },
  };
  const servicio = crearServicioComunidades({ almacen, reloj: () => new Date(0) });
  return { docs, servicio };
}

describe("crear", () => {
  it("deja a quien la crea como responsable y no expone ids de Telegram", async () => {
    const e = escenario();
    const v = await e.servicio.crear("ana", { nombre: "  Primaria X  ", tipo: "escuela" });
    expect(v).toMatchObject({
      nombre: "Primaria X",
      tipo: "escuela",
      rol: "responsable",
      telegram: null,
    });
    expect(e.docs[0]?.miembros).toEqual([{ uid: "ana", rol: "responsable" }]);
    expect(e.docs[0]?.creado).toEqual(new Date(0));
  });

  it.each(["", " ", "a", "x".repeat(81)])("rechaza el nombre %j", async (nombre) => {
    const e = escenario();
    await expect(e.servicio.crear("ana", { nombre, tipo: "otro" })).rejects.toBeInstanceOf(
      SolicitudInvalida,
    );
    expect(e.docs).toHaveLength(0);
  });

  it("pone un tope de comunidades por responsable", async () => {
    const e = escenario();
    for (let i = 0; i < MAX_COMUNIDADES_RESPONSABLE; i++) {
      await e.servicio.crear("ana", { nombre: `Comunidad ${i}`, tipo: "otro" });
    }
    await expect(
      e.servicio.crear("ana", { nombre: "Una más", tipo: "otro" }),
    ).rejects.toBeInstanceOf(Conflicto);
    // Otra persona no se ve afectada.
    await e.servicio.crear("beto", { nombre: "De Beto", tipo: "hogar" });
  });
});

describe("deUsuario", () => {
  it("lista solo las comunidades de la persona, con su rol", async () => {
    const e = escenario();
    await e.servicio.crear("ana", { nombre: "De Ana", tipo: "hogar" });
    await e.servicio.crear("beto", { nombre: "De Beto", tipo: "hogar" });
    e.docs[1]?.miembros.push({ uid: "ana", rol: "integrante" });
    const v = await e.servicio.deUsuario("ana");
    expect(v.map((c) => [c.nombre, c.rol])).toEqual([
      ["De Ana", "responsable"],
      ["De Beto", "integrante"],
    ]);
    expect(await e.servicio.deUsuario("nadie")).toEqual([]);
  });

  it("muestra el título del chat de Telegram pero no su id", async () => {
    const e = escenario();
    await e.servicio.crear("ana", { nombre: "De Ana", tipo: "hogar" });
    (e.docs[0] as ComunidadDoc).telegram = {
      chat_id: -4242,
      titulo: "Padres",
      vinculado: new Date(0),
    };
    const [v] = await e.servicio.deUsuario("ana");
    expect(v?.telegram).toEqual({ vinculado: true, titulo: "Padres" });
    expect(JSON.stringify(v)).not.toContain("4242");
  });
});

describe("acceso", () => {
  it("devuelve la comunidad y el rol a un miembro", async () => {
    const e = escenario();
    const v = await e.servicio.crear("ana", { nombre: "De Ana", tipo: "hogar" });
    const a = await e.servicio.acceso("ana", new ObjectId(v.id), "responsable");
    expect(a.rol).toBe("responsable");
  });

  it("una comunidad ajena y una inexistente dan el mismo NoEncontrado", async () => {
    const e = escenario();
    const v = await e.servicio.crear("ana", { nombre: "De Ana", tipo: "hogar" });
    const ajena = await e.servicio.acceso("beto", new ObjectId(v.id)).catch((x) => x);
    const noExiste = await e.servicio.acceso("beto", new ObjectId()).catch((x) => x);
    expect(ajena).toBeInstanceOf(NoEncontrado);
    expect(noExiste).toBeInstanceOf(NoEncontrado);
    expect(ajena.message).toBe(noExiste.message);
  });

  it("un integrante puede leer pero no hacer lo del responsable (403, porque ya sabe que existe)", async () => {
    const e = escenario();
    const v = await e.servicio.crear("ana", { nombre: "De Ana", tipo: "hogar" });
    e.docs[0]?.miembros.push({ uid: "beto", rol: "integrante" });
    const id = new ObjectId(v.id);
    expect((await e.servicio.acceso("beto", id, "integrante")).rol).toBe("integrante");
    await expect(e.servicio.acceso("beto", id, "responsable")).rejects.toBeInstanceOf(SinPermiso);
  });
});

describe("desvincularTelegram", () => {
  it("el responsable quita el chat y la vista ya no lo trae; repetirlo no falla", async () => {
    const e = escenario();
    const v = await e.servicio.crear("ana", { nombre: "De Ana", tipo: "hogar" });
    const doc = e.docs[0];
    if (doc) doc.telegram = { chat_id: 5, titulo: "Grupo", vinculado: new Date(0) };
    const id = new ObjectId(v.id);
    const r = await e.servicio.desvincularTelegram("ana", id);
    expect(r.telegram).toBeNull();
    expect(e.docs[0]?.telegram).toBeNull();
    await expect(e.servicio.desvincularTelegram("ana", id)).resolves.toBeDefined();
  });

  it("un integrante recibe 403 y un ajeno 404", async () => {
    const e = escenario();
    const v = await e.servicio.crear("ana", { nombre: "De Ana", tipo: "hogar" });
    e.docs[0]?.miembros.push({ uid: "beto", rol: "integrante" });
    const id = new ObjectId(v.id);
    await expect(e.servicio.desvincularTelegram("beto", id)).rejects.toBeInstanceOf(SinPermiso);
    await expect(e.servicio.desvincularTelegram("carla", id)).rejects.toBeInstanceOf(NoEncontrado);
  });
});
