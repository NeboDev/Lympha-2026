import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import {
  Conflicto,
  NoEncontrado,
  ServicioNoDisponible,
  SinPermiso,
  SolicitudInvalida,
} from "../../dominio/errores.ts";
import { catalogoDePrueba, T0 } from "../../test/falsos.ts";
import type { AlertaDoc } from "../alertas/index.ts";
import {
  type AlmacenComunidades,
  type ComunidadDoc,
  crearServicioComunidades,
} from "../comunidades/index.ts";
import {
  type AlmacenNodos,
  crearServicioNodos,
  type EventoNodo,
  MAX_NODOS_POR_COMUNIDAD,
  type NodoDoc,
  type PuntoSerie,
  type ResultadoToken,
} from "./index.ts";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345"; // 32 caracteres, como los de Blynk
const HORA = 3600_000;

function escenario(opciones: { token?: ResultadoToken } = {}) {
  const comunidades: ComunidadDoc[] = [];
  const nodos: NodoDoc[] = [];
  const consultas: { serie: unknown[][]; eventos: unknown[][] } = { serie: [], eventos: [] };
  const estado = { pulsoActivo: false };
  let serieDevuelta: PuntoSerie[] = [];
  let alertasDevueltas: AlertaDoc[] = [];
  let eventosDevueltos: EventoNodo[] = [];

  const almacenComunidades: AlmacenComunidades = {
    async insertar(c) {
      comunidades.push(c);
    },
    async obtener(id) {
      return comunidades.find((c) => c._id.equals(id)) ?? null;
    },
    async deUsuario(uid) {
      return comunidades.filter((c) => c.miembros.some((m) => m.uid === uid));
    },
    async contarResponsable() {
      return 0;
    },
    async desvincularTelegram(id) {
      const c = comunidades.find((x) => x._id.equals(id));
      if (c) c.telegram = null;
    },
  };
  const almacen: AlmacenNodos = {
    async nodo(id) {
      return nodos.find((n) => n._id.equals(id) && !n.archivado) ?? null;
    },
    async nodosDeComunidad(id) {
      return nodos.filter((n) => n.comunidad_id.equals(id) && !n.archivado);
    },
    async nodoConArchivados(id) {
      return nodos.find((n) => n._id.equals(id)) ?? null;
    },
    async archivadosDeComunidad(id) {
      return nodos.filter((n) => n.comunidad_id.equals(id) && n.archivado);
    },
    async actualizar(id, cambios) {
      const n = nodos.find((x) => x._id.equals(id) && !x.archivado);
      if (!n) return null;
      if (cambios.nombre !== undefined) n.nombre = cambios.nombre;
      if (cambios.ubicacion === null) delete n.ubicacion;
      else if (cambios.ubicacion !== undefined) n.ubicacion = cambios.ubicacion;
      return n;
    },
    async restaurar(id) {
      const n = nodos.find((x) => x._id.equals(id) && x.archivado);
      if (!n) return false;
      delete n.archivado;
      return true;
    },
    async archivar(id, ahora) {
      const n = nodos.find((x) => x._id.equals(id) && !x.archivado);
      if (!n) return "no_existe";
      if (estado.pulsoActivo) return "pulso_activo";
      n.archivado = ahora;
      return "ok";
    },

    async existeNombre(id, nombre) {
      return nodos.some((n) => n.comunidad_id.equals(id) && n.nombre === nombre && !n.archivado);
    },
    async insertar(n) {
      nodos.push(n);
    },
    async serie(...args) {
      consultas.serie.push(args);
      return serieDevuelta;
    },
    async alertas(...args) {
      consultas.eventos.push(["alertas", ...args]);
      return alertasDevueltas;
    },
    async eventos(...args) {
      consultas.eventos.push(["eventos", ...args]);
      return eventosDevueltos;
    },
  };
  const tokensComprobados: string[] = [];
  const servicioComunidades = crearServicioComunidades({ almacen: almacenComunidades });
  const servicio = crearServicioNodos({
    almacen,
    comunidades: servicioComunidades,
    comprobador: {
      async comprobar(t) {
        tokensComprobados.push(t);
        return opciones.token ?? "conectado";
      },
    },
    catalogo: catalogoDePrueba,
    blynkHost: "blynk.cloud",
    cifrar: (t) => `cifrado(${t.length})`,
    reloj: () => new Date(T0),
  });

  return {
    servicio,
    estado,
    nodos,
    comunidades,
    consultas,
    tokensComprobados,
    devolverSerie: (s: PuntoSerie[]) => {
      serieDevuelta = s;
    },
    devolverEventos: (a: AlertaDoc[], e: EventoNodo[]) => {
      alertasDevueltas = a;
      eventosDevueltos = e;
    },
    /** Una comunidad de Ana (responsable) con Beto de integrante. */
    async comunidadDeAna() {
      const v = await servicioComunidades.crear("ana", { nombre: "Primaria X", tipo: "escuela" });
      comunidades[0]?.miembros.push({ uid: "beto", rol: "integrante" });
      return new ObjectId(v.id);
    },
  };
}

async function conNodo(opciones: { token?: ResultadoToken } = {}) {
  const e = escenario(opciones);
  const comunidadId = await e.comunidadDeAna();
  const v = await e.servicio.alta("ana", comunidadId, {
    nombre: "Tinaco azotea",
    tokenBlynk: TOKEN,
  });
  return { ...e, comunidadId, nodoId: new ObjectId(v.id) };
}

describe("alta", () => {
  it("valida el token con Blynk, lo cifra, guarda el mapeo y no lo devuelve", async () => {
    const e = escenario();
    const comunidadId = await e.comunidadDeAna();
    const v = await e.servicio.alta("ana", comunidadId, {
      nombre: "  Tinaco azotea ",
      tokenBlynk: TOKEN,
      ubicacion: { texto: "Azotea, edificio B", lat: 19.04, lng: -98.2 },
    });

    expect(e.tokensComprobados).toEqual([TOKEN]);
    expect(v).toMatchObject({
      nombre: "Tinaco azotea",
      conectado: true,
      conexion: "sin_lecturas",
      rol: "responsable",
      ubicacion: { texto: "Azotea, edificio B", lat: 19.04, lng: -98.2 },
    });
    expect(v.parametros.map((p) => p.id)).toEqual(["ph"]);

    const guardado = e.nodos[0] as NodoDoc;
    expect(guardado.blynk.token_cifrado).toBe("cifrado(32)");
    expect(guardado.blynk.mapeo.valores).toEqual({ ph: "v2" });
    expect(guardado.ultimo).toBeNull();
    // Ni el token ni el mapeo salen en la respuesta.
    const json = JSON.stringify(v);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain("cifrado(");
    expect(json).not.toMatch(/blynk|mapeo|token/i);
  });

  it("un token válido con la placa apagada se acepta y avisa que no está conectada", async () => {
    const e = escenario({ token: "desconectado" });
    const comunidadId = await e.comunidadDeAna();
    const v = await e.servicio.alta("ana", comunidadId, { nombre: "Cisterna", tokenBlynk: TOKEN });
    expect(v.conectado).toBe(false);
    expect(e.nodos).toHaveLength(1);
  });

  it("un token que Blynk no reconoce no guarda nada", async () => {
    const e = escenario({ token: "invalido" });
    const comunidadId = await e.comunidadDeAna();
    await expect(
      e.servicio.alta("ana", comunidadId, { nombre: "Cisterna", tokenBlynk: TOKEN }),
    ).rejects.toMatchObject({ codigo: "token_blynk_invalido", estado: 422 });
    expect(e.nodos).toHaveLength(0);
  });

  it("si Blynk no responde, es un 503 y no se guarda nada", async () => {
    const e = escenario({ token: "sin_respuesta" });
    const comunidadId = await e.comunidadDeAna();
    await expect(
      e.servicio.alta("ana", comunidadId, { nombre: "Cisterna", tokenBlynk: TOKEN }),
    ).rejects.toBeInstanceOf(ServicioNoDisponible);
    expect(e.nodos).toHaveLength(0);
  });

  it("un integrante no puede dar de alta (403) y un ajeno ni siquiera ve la comunidad (404)", async () => {
    const e = escenario();
    const comunidadId = await e.comunidadDeAna();
    await expect(
      e.servicio.alta("beto", comunidadId, { nombre: "Cisterna", tokenBlynk: TOKEN }),
    ).rejects.toBeInstanceOf(SinPermiso);
    await expect(
      e.servicio.alta("intruso", comunidadId, { nombre: "Cisterna", tokenBlynk: TOKEN }),
    ).rejects.toBeInstanceOf(NoEncontrado);
    expect(e.tokensComprobados).toEqual([]); // ni se molesta a Blynk
  });

  it("rechaza nombres repetidos en la comunidad", async () => {
    const e = await conNodo();
    await expect(
      e.servicio.alta("ana", e.comunidadId, { nombre: "Tinaco azotea", tokenBlynk: TOKEN }),
    ).rejects.toBeInstanceOf(Conflicto);
  });

  it.each([
    ["nombre corto", { nombre: "a", tokenBlynk: TOKEN }],
    ["nombre larguísimo", { nombre: "x".repeat(81), tokenBlynk: TOKEN }],
    ["token con caracteres raros", { nombre: "Nodo", tokenBlynk: "token con espacios!!!!!" }],
    ["token corto", { nombre: "Nodo", tokenBlynk: "abc" }],
    ["parámetro que no se mide", { nombre: "Nodo", tokenBlynk: TOKEN, parametros: ["turbidez"] }],
    ["parámetro desconocido", { nombre: "Nodo", tokenBlynk: TOKEN, parametros: ["oro"] }],
    ["parámetros repetidos", { nombre: "Nodo", tokenBlynk: TOKEN, parametros: ["ph", "ph"] }],
    ["sin parámetros", { nombre: "Nodo", tokenBlynk: TOKEN, parametros: [] }],
  ])("rechaza %s antes de hablar con Blynk", async (_nombre, datos) => {
    const e = escenario();
    const comunidadId = await e.comunidadDeAna();
    await expect(e.servicio.alta("ana", comunidadId, datos)).rejects.toBeInstanceOf(
      SolicitudInvalida,
    );
    expect(e.tokensComprobados).toEqual([]);
    expect(e.nodos).toHaveLength(0);
  });

  it("pone un tope de nodos por comunidad", async () => {
    const e = escenario();
    const comunidadId = await e.comunidadDeAna();
    for (let i = 0; i < MAX_NODOS_POR_COMUNIDAD; i++) {
      await e.servicio.alta("ana", comunidadId, { nombre: `Nodo ${i}`, tokenBlynk: TOKEN });
    }
    await expect(
      e.servicio.alta("ana", comunidadId, { nombre: "Uno más", tokenBlynk: TOKEN }),
    ).rejects.toMatchObject({ codigo: "demasiados_nodos" });
  });
});

describe("detalle y acceso", () => {
  it("muestra el parámetro con su norma y la conexión según el último dato", async () => {
    const e = await conNodo();
    const sin = await e.servicio.detalle("ana", e.nodoId);
    expect(sin.conexion).toBe("sin_lecturas");
    expect(sin.parametros[0]).toMatchObject({
      id: "ph",
      nombre: "pH",
      norma: { min: 6.5, max: 8.5, fuente: "NOM-127-SSA1-2021" },
    });

    const nodo = e.nodos[0] as NodoDoc;
    nodo.ultimo = {
      ts: new Date(T0),
      v: { ph: 7.2 },
      estado: "en_rango",
      estados: { ph: "en_rango" },
      seq: 5,
      sesion: 0,
      estable: true,
      ultimo_cambio: new Date(T0),
      sin_datos: false,
    };
    expect((await e.servicio.detalle("beto", e.nodoId)).conexion).toBe("conectado");
    nodo.ultimo.sin_datos = true;
    const parado = await e.servicio.detalle("beto", e.nodoId);
    expect(parado).toMatchObject({ conexion: "sin_datos", rol: "integrante" });
    expect(parado.ultimo?.v).toEqual({ ph: 7.2 });
  });

  it("un umbral propio del nodo sustituye a la norma y lo dice", async () => {
    const e = await conNodo();
    (e.nodos[0] as NodoDoc).umbrales = { ph: { min: 6, max: 9 } };
    const v = await e.servicio.detalle("ana", e.nodoId);
    expect(v.parametros[0]?.norma).toEqual({ min: 6, max: 9, fuente: "Umbral de este nodo" });
  });

  it("un nodo ajeno y uno inexistente dan el mismo 404", async () => {
    const e = await conNodo();
    const ajeno = await e.servicio.detalle("intruso", e.nodoId).catch((x) => x);
    const noExiste = await e.servicio.detalle("ana", new ObjectId()).catch((x) => x);
    expect(ajeno).toBeInstanceOf(NoEncontrado);
    expect(noExiste).toBeInstanceOf(NoEncontrado);
    // Ni el mensaje ni el código deben delatar que el nodo existe.
    expect(ajeno.message).toBe(noExiste.message);
    expect(ajeno.codigo).toBe(noExiste.codigo);
    expect(ajeno.estado).toBe(404);
  });

  it("deComunidad lista los nodos solo a los miembros", async () => {
    const e = await conNodo();
    expect((await e.servicio.deComunidad("beto", e.comunidadId)).map((n) => n.nombre)).toEqual([
      "Tinaco azotea",
    ]);
    await expect(e.servicio.deComunidad("intruso", e.comunidadId)).rejects.toBeInstanceOf(
      NoEncontrado,
    );
  });
});

describe("serie", () => {
  it("sin periodo ni paso usa las últimas 24 h con un paso redondo (~240 puntos como máximo)", async () => {
    const e = await conNodo();
    const punto: PuntoSerie = {
      ts: new Date(T0),
      n: 3,
      v: { ph: { prom: 7, min: 6.9, max: 7.1 } },
    };
    e.devolverSerie([punto]);
    const r = await e.servicio.serie("ana", e.nodoId, {});
    expect(r.paso_s).toBe(600); // 86400 s / 240 = 360 → el siguiente paso redondo
    expect(r.hasta).toEqual(new Date(T0));
    expect(r.desde).toEqual(new Date(T0 - 24 * HORA));
    expect(r.parametros).toEqual(["ph"]);
    expect(r.puntos).toEqual([punto]);
    expect(e.consultas.serie[0]).toEqual([e.nodoId, ["ph"], r.desde, r.hasta, 600]);
  });

  it("el paso crece con el periodo y nunca pasa de un día", async () => {
    const e = await conNodo();
    const paso = async (dias: number) =>
      (await e.servicio.serie("ana", e.nodoId, { desde: new Date(T0 - dias * 24 * HORA) })).paso_s;
    expect(await paso(1)).toBe(600);
    expect(await paso(7)).toBe(3600);
    expect(await paso(30)).toBe(14_400);
    expect(await paso(90)).toBe(43_200);
    const corta = await e.servicio.serie("ana", e.nodoId, { desde: new Date(T0 - 600_000) });
    expect(corta.paso_s).toBe(5);
  });

  it("respeta un paso pedido, pero no deja pedir más de 1000 puntos ni menos de 5 s", async () => {
    const e = await conNodo();
    expect((await e.servicio.serie("ana", e.nodoId, { pasoS: 3600 })).paso_s).toBe(3600);
    await expect(e.servicio.serie("ana", e.nodoId, { pasoS: 60 })).rejects.toMatchObject({
      codigo: "demasiados_puntos",
    });
    await expect(e.servicio.serie("ana", e.nodoId, { pasoS: 2 })).rejects.toMatchObject({
      codigo: "paso_invalido",
    });
  });

  it("rechaza periodos al revés o de más de 90 días, y recorta lo que termina en el futuro", async () => {
    const e = await conNodo();
    await expect(
      e.servicio.serie("ana", e.nodoId, { desde: new Date(T0), hasta: new Date(T0 - HORA) }),
    ).rejects.toMatchObject({ codigo: "periodo_invalido" });
    await expect(
      e.servicio.serie("ana", e.nodoId, { desde: new Date(T0 - 91 * 24 * HORA) }),
    ).rejects.toMatchObject({ codigo: "periodo_invalido" });
    const r = await e.servicio.serie("ana", e.nodoId, {
      desde: new Date(T0 - HORA),
      hasta: new Date(T0 + 10 * HORA),
    });
    expect(r.hasta).toEqual(new Date(T0));
  });

  it("un ajeno no consulta nada", async () => {
    const e = await conNodo();
    await expect(e.servicio.serie("intruso", e.nodoId, {})).rejects.toBeInstanceOf(NoEncontrado);
    expect(e.consultas.serie).toHaveLength(0);
  });
});

describe("eventos", () => {
  it("devuelve alertas con título y detalle legibles, y eventos marcando las propios", async () => {
    const e = await conNodo();
    const alerta: AlertaDoc = {
      _id: new ObjectId(),
      nodo_id: e.nodoId,
      comunidad_id: e.comunidadId,
      tipo: "nivel",
      parametro: "ph",
      severidad: "alta",
      severidad_maxima: "critica",
      estado: "cerrada",
      abierta: new Date(T0 - 3 * HORA),
      cerrada: new Date(T0 - 3 * HORA + 18 * 60_000),
      ultimo_aviso: new Date(T0 - 3 * HORA),
      recordatorios: 0,
      valor_apertura: 5.2,
      valor_cierre: 7,
    };
    e.devolverEventos(
      [alerta],
      [
        {
          ts: new Date(T0 - HORA),
          tipo: "bitacora",
          mensaje: "Se lavó el tinaco.",
          autor_uid: "ana",
        },
        { ts: new Date(T0 - 2 * HORA), tipo: "sin_datos", mensaje: "sin datos", autor_uid: null },
      ],
    );
    const r = await e.servicio.eventos("ana", e.nodoId, {});
    expect(r.alertas).toEqual([
      expect.objectContaining({
        id: alerta._id.toHexString(),
        titulo: "pH crítico",
        detalle: "Duró 18 minutos · valor al abrir 5.20",
        estado: "cerrada",
      }),
    ]);
    expect(r.eventos.map((x) => [x.tipo, x.propia])).toEqual([
      ["bitacora", true],
      ["sin_datos", false],
    ]);
    // Los uid de los autores no salen.
    expect(JSON.stringify(r)).not.toContain("autor");
  });

  it("limita la cantidad pedida a 200 y usa 30 días por defecto", async () => {
    const e = await conNodo();
    await e.servicio.eventos("beto", e.nodoId, { limite: 9999 });
    const [alertas, eventos] = e.consultas.eventos;
    const desde = new Date(T0 - 30 * 24 * HORA);
    expect(alertas).toEqual(["alertas", e.nodoId, desde, new Date(T0), 200]);
    expect(eventos).toEqual(["eventos", e.nodoId, e.comunidadId, desde, new Date(T0), 200]);
  });
});

describe("quitar", () => {
  it("archiva el nodo: deja de verse, libera el nombre y conserva el documento", async () => {
    const e = await conNodo();
    await e.servicio.quitar("ana", e.nodoId);
    expect(e.nodos[0]?.archivado).toBeInstanceOf(Date);
    await expect(e.servicio.detalle("ana", e.nodoId)).rejects.toBeInstanceOf(NoEncontrado);
    expect(await e.servicio.deComunidad("ana", e.comunidadId)).toEqual([]);
    // el mismo nombre se puede volver a usar
    const otra = await e.servicio.alta("ana", e.comunidadId, {
      nombre: "Tinaco azotea",
      tokenBlynk: TOKEN,
    });
    expect(otra.nombre).toBe("Tinaco azotea");
  });

  it("solo el responsable puede quitarlo: el integrante recibe 403 y el ajeno 404", async () => {
    const e = await conNodo();
    await expect(e.servicio.quitar("beto", e.nodoId)).rejects.toBeInstanceOf(SinPermiso);
    await expect(e.servicio.quitar("carla", e.nodoId)).rejects.toBeInstanceOf(NoEncontrado);
    expect(e.nodos[0]?.archivado).toBeUndefined();
  });

  it("no se quita con un pulso del actuador pendiente o en curso", async () => {
    const e = await conNodo();
    e.estado.pulsoActivo = true;
    await expect(e.servicio.quitar("ana", e.nodoId)).rejects.toBeInstanceOf(Conflicto);
    expect(e.nodos[0]?.archivado).toBeUndefined();
  });

  it("quitar dos veces da 404 la segunda", async () => {
    const e = await conNodo();
    await e.servicio.quitar("ana", e.nodoId);
    await expect(e.servicio.quitar("ana", e.nodoId)).rejects.toBeInstanceOf(NoEncontrado);
  });
});

describe("editar", () => {
  it("cambia el nombre y el lugar, y el lugar se puede borrar", async () => {
    const e = await conNodo();
    const v = await e.servicio.editar("ana", e.nodoId, {
      nombre: "  San Juan Bosco ",
      ubicacion: { texto: "Patio" },
    });
    expect(v.nombre).toBe("San Juan Bosco");
    expect(v.ubicacion).toEqual({ texto: "Patio" });
    const sin = await e.servicio.editar("ana", e.nodoId, { ubicacion: null });
    expect(sin.ubicacion).toBeNull();
    expect(sin.nombre).toBe("San Juan Bosco");
  });

  it("rechaza nombres cortos y repetidos, pero dejar el mismo nombre no estorba", async () => {
    const e = await conNodo();
    await e.servicio.alta("ana", e.comunidadId, { nombre: "Cisterna", tokenBlynk: TOKEN });
    await expect(e.servicio.editar("ana", e.nodoId, { nombre: "x" })).rejects.toBeInstanceOf(
      SolicitudInvalida,
    );
    await expect(e.servicio.editar("ana", e.nodoId, { nombre: "Cisterna" })).rejects.toBeInstanceOf(
      Conflicto,
    );
    const igual = await e.servicio.editar("ana", e.nodoId, { nombre: "Tinaco azotea" });
    expect(igual.nombre).toBe("Tinaco azotea");
  });

  it("solo el responsable: el integrante recibe 403 y el ajeno 404", async () => {
    const e = await conNodo();
    await expect(e.servicio.editar("beto", e.nodoId, { nombre: "Otro" })).rejects.toBeInstanceOf(
      SinPermiso,
    );
    await expect(e.servicio.editar("carla", e.nodoId, { nombre: "Otro" })).rejects.toBeInstanceOf(
      NoEncontrado,
    );
  });
});

describe("quitados y restaurar", () => {
  it("lista los quitados y los restaura con sus datos", async () => {
    const e = await conNodo();
    await e.servicio.quitar("ana", e.nodoId);
    const lista = await e.servicio.quitados("ana", e.comunidadId);
    expect(lista.map((n) => n.nombre)).toEqual(["Tinaco azotea"]);
    const v = await e.servicio.restaurar("ana", e.nodoId);
    expect(v.nombre).toBe("Tinaco azotea");
    expect(await e.servicio.quitados("ana", e.comunidadId)).toEqual([]);
    expect((await e.servicio.deComunidad("ana", e.comunidadId)).length).toBe(1);
  });

  it("restaurar un nodo que no está quitado es 409; uno ajeno, 404; un integrante, 403", async () => {
    const e = await conNodo();
    await expect(e.servicio.restaurar("ana", e.nodoId)).rejects.toBeInstanceOf(Conflicto);
    await e.servicio.quitar("ana", e.nodoId);
    await expect(e.servicio.restaurar("carla", e.nodoId)).rejects.toBeInstanceOf(NoEncontrado);
    await expect(e.servicio.restaurar("beto", e.nodoId)).rejects.toBeInstanceOf(SinPermiso);
    await expect(e.servicio.quitados("beto", e.comunidadId)).rejects.toBeInstanceOf(SinPermiso);
  });

  it("no restaura si el nombre ya lo usa otro nodo activo", async () => {
    const e = await conNodo();
    await e.servicio.quitar("ana", e.nodoId);
    await e.servicio.alta("ana", e.comunidadId, { nombre: "Tinaco azotea", tokenBlynk: TOKEN });
    await expect(e.servicio.restaurar("ana", e.nodoId)).rejects.toMatchObject({
      codigo: "nodo_repetido",
    });
  });
});
