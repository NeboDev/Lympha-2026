import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import {
  Conflicto,
  NoEncontrado,
  ServicioNoDisponible,
  SinPermiso,
  SolicitudInvalida,
} from "../../dominio/errores.ts";
import { loggerDePrueba, nodoDePrueba, T0 } from "../../test/falsos.ts";
import type { ConfigActuador, NodoDoc, ServicioNodos, UltimoNodo } from "../nodos/index.ts";
import {
  type AccionDoc,
  type AlmacenControl,
  crearControl,
  type DatosConfigActuador,
  type EscritorActuador,
  type EventoActuador,
  VIGENCIA_CONFIRMACION_S,
} from "./index.ts";

const CONFIG: DatosConfigActuador = {
  habilitado: true,
  nombre: "Bomba de cloro",
  pulso_max_s: 30,
  enfriamiento_s: 300,
  simulado: true,
  auto_detener: true,
};

function ultimo(estado: UltimoNodo["estado"], sinDatos = false): UltimoNodo {
  return {
    ts: new Date(T0),
    v: { ph: 7.2 },
    estado,
    estados: {},
    seq: 1,
    sesion: 0,
    estable: true,
    ultimo_cambio: new Date(T0),
    sin_datos: sinDatos,
  };
}

function escenario(opciones: { habilitado?: boolean } = {}) {
  let ahora = T0;
  const nodo: NodoDoc = {
    ...nodoDePrueba(new ObjectId(), "Tinaco azotea"),
    ultimo: ultimo("en_rango"),
  };
  if (opciones.habilitado !== false) {
    nodo.actuador = { ...CONFIG, pin: "v8" } as ConfigActuador;
  }
  const acciones: AccionDoc[] = [];
  const eventos: EventoActuador[] = [];
  const escrituras: { pin: string; valor: 0 | 1 }[] = [];
  const control = { falla: false };

  const almacen: AlmacenControl = {
    async guardarConfig(_id, config) {
      if (config) nodo.actuador = config;
      else delete nodo.actuador;
    },
    async insertar(a) {
      if (
        acciones.some(
          (x) =>
            x.nodo_id.equals(a.nodo_id) && (x.estado === "pendiente" || x.estado === "en_curso"),
        )
      ) {
        return "ocupado";
      }
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
      return (
        acciones.find(
          (a) => a.nodo_id.equals(nodoId) && (a.estado === "pendiente" || a.estado === "en_curso"),
        ) ?? null
      );
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
      return id.equals(nodo._id) ? nodo : null;
    },
    async registrarEvento(e) {
      eventos.push(e);
    },
  };
  const escritor: EscritorActuador = {
    async escribir(_n, pin, valor) {
      if (control.falla) throw new Error("Blynk caído");
      escrituras.push({ pin, valor });
    },
  };
  const roles: Record<string, "responsable" | "integrante"> = {
    ana: "responsable",
    ana2: "responsable",
    beto: "integrante",
  };
  const nodos: Pick<ServicioNodos, "acceso"> = {
    async acceso(uid, id, minimo = "integrante") {
      const rol = roles[uid];
      if (!id.equals(nodo._id) || !rol) throw new NoEncontrado();
      if (minimo === "responsable" && rol !== "responsable") throw new SinPermiso();
      return { nodo, rol, comunidad: {} as never };
    },
  };
  const { logger, logs } = loggerDePrueba();
  const servicio = crearControl({ almacen, escritor, nodos, reloj: () => new Date(ahora), logger });
  return {
    servicio,
    nodo,
    acciones,
    eventos,
    escrituras,
    logs,
    control,
    avanzar: (s: number) => {
      ahora += s * 1000;
    },
    ahora: () => new Date(ahora),
    estadoAgua: (e: UltimoNodo["estado"], sinDatos = false) => {
      nodo.ultimo = ultimo(e, sinDatos);
    },
  };
}

type Escenario = ReturnType<typeof escenario>;

async function pedirYConfirmar(e: Escenario, s = 20) {
  const a = await e.servicio.solicitar("ana", e.nodo._id, { duracionS: s });
  await e.servicio.confirmar("ana", e.nodo._id, new ObjectId(a.id));
  return a;
}

describe("configurar", () => {
  it("el responsable habilita el actuador; el pin sale del mapeo del nodo, no de la petición", async () => {
    const e = escenario({ habilitado: false });
    const r = await e.servicio.configurar("ana", e.nodo._id, CONFIG);
    expect(r.actuador).toMatchObject({
      habilitado: true,
      nombre: "Bomba de cloro",
      pin: "v8",
      simulado: true,
      auto_detener: true,
    });
    expect(e.nodo.actuador?.pin).toBe("v8");
  });

  it.each([
    ["nombre corto", { ...CONFIG, nombre: "a" }],
    ["nombre largo", { ...CONFIG, nombre: "x".repeat(41) }],
    ["pulso cero", { ...CONFIG, pulso_max_s: 0 }],
    ["pulso de más de 120 s", { ...CONFIG, pulso_max_s: 121 }],
    ["pulso con decimales", { ...CONFIG, pulso_max_s: 2.5 }],
    ["enfriamiento negativo", { ...CONFIG, enfriamiento_s: -1 }],
    ["enfriamiento de más de una hora", { ...CONFIG, enfriamiento_s: 3601 }],
  ])("rechaza %s", async (_n, datos) => {
    const e = escenario({ habilitado: false });
    await expect(e.servicio.configurar("ana", e.nodo._id, datos)).rejects.toBeInstanceOf(
      SolicitudInvalida,
    );
    expect(e.nodo.actuador).toBeUndefined();
  });

  it("solo el responsable; un integrante recibe 403 y un ajeno 404", async () => {
    const e = escenario({ habilitado: false });
    await expect(e.servicio.configurar("beto", e.nodo._id, CONFIG)).rejects.toBeInstanceOf(
      SinPermiso,
    );
    await expect(e.servicio.configurar("intruso", e.nodo._id, CONFIG)).rejects.toBeInstanceOf(
      NoEncontrado,
    );
  });

  it("no se deshabilita con un pulso pendiente o en curso", async () => {
    const e = escenario();
    await e.servicio.solicitar("ana", e.nodo._id, { duracionS: 10 });
    await expect(
      e.servicio.configurar("ana", e.nodo._id, { ...CONFIG, habilitado: false }),
    ).rejects.toBeInstanceOf(Conflicto);
    expect(e.nodo.actuador?.habilitado).toBe(true);
  });
});

describe("solicitar", () => {
  it("deja el pulso pendiente y NO manda nada a Blynk: falta la confirmación de una persona", async () => {
    const e = escenario();
    const a = await e.servicio.solicitar("ana", e.nodo._id, {
      duracionS: 20,
      motivo: "  el pH está bajo  ",
    });
    expect(a).toMatchObject({
      estado: "pendiente",
      duracion_s: 20,
      motivo: "el pH está bajo",
      simulado: true,
      automatica: false,
    });
    expect(a.expira.getTime() - e.ahora().getTime()).toBe(VIGENCIA_CONFIRMACION_S * 1000);
    expect(e.escrituras).toEqual([]);
    expect(JSON.stringify(a)).not.toContain("ana");
  });

  it("sin actuador habilitado, no", async () => {
    const e = escenario({ habilitado: false });
    await expect(e.servicio.solicitar("ana", e.nodo._id, { duracionS: 10 })).rejects.toMatchObject({
      codigo: "sin_actuador",
    });
  });

  it.each([0, 31, 2.5, -1])("rechaza una duración de %s s", async (s) => {
    const e = escenario();
    await expect(e.servicio.solicitar("ana", e.nodo._id, { duracionS: s })).rejects.toMatchObject({
      codigo: "duracion_invalida",
    });
  });

  it("con el agua fuera de rango, la sonda dudosa o el nodo callado, se bloquea con el motivo", async () => {
    const e = escenario();
    for (const [estado, sin] of [
      ["fuera_de_rango", false],
      ["critico", false],
      ["revisar_sensor", false],
      ["en_rango", true],
    ] as const) {
      e.estadoAgua(estado, sin);
      const error = await e.servicio
        .solicitar("ana", e.nodo._id, { duracionS: 10 })
        .catch((x) => x);
      expect(error, `${estado}/${sin}`).toBeInstanceOf(SolicitudInvalida);
      expect(error.codigo).toBe("bloqueado");
    }
    expect(e.acciones).toHaveLength(0);
  });

  it("solo una acción viva por nodo", async () => {
    const e = escenario();
    await e.servicio.solicitar("ana", e.nodo._id, { duracionS: 10 });
    await expect(e.servicio.solicitar("ana2", e.nodo._id, { duracionS: 10 })).rejects.toMatchObject(
      { codigo: "accion_activa" },
    );
  });

  it("solo el responsable puede pedirlo", async () => {
    const e = escenario();
    await expect(
      e.servicio.solicitar("beto", e.nodo._id, { duracionS: 10 }),
    ).rejects.toBeInstanceOf(SinPermiso);
  });

  it("un motivo larguísimo se rechaza", async () => {
    const e = escenario();
    await expect(
      e.servicio.solicitar("ana", e.nodo._id, { duracionS: 10, motivo: "x".repeat(201) }),
    ).rejects.toMatchObject({ codigo: "motivo_invalido" });
  });
});

describe("confirmar", () => {
  it("manda un 1 al pin del relevador una sola vez, deja el pulso en curso y lo registra con su autor", async () => {
    const e = escenario();
    const a = await e.servicio.solicitar("ana", e.nodo._id, { duracionS: 20 });
    e.avanzar(30);
    const r = await e.servicio.confirmar("ana2", e.nodo._id, new ObjectId(a.id));
    expect(r.estado).toBe("en_curso");
    expect(r.fin?.getTime()).toBe(e.ahora().getTime() + 20_000);
    expect(e.escrituras).toEqual([{ pin: "v8", valor: 1 }]);
    expect(e.acciones[0]).toMatchObject({ solicita_uid: "ana", confirma_uid: "ana2" });
    expect(e.eventos).toHaveLength(1);
    expect(e.eventos[0]).toMatchObject({ tipo: "actuador", severidad: "info", autor_uid: "ana2" });
    expect(e.eventos[0]?.mensaje).toBe(
      "Pulso de 20 s: orden enviada a «Bomba de cloro» (simulado). Atl no ve si el relevador actuó: lo decide el firmware.",
    );
  });

  it("si llegan dos confirmaciones a la vez, solo una manda la orden", async () => {
    const e = escenario();
    const a = await e.servicio.solicitar("ana", e.nodo._id, { duracionS: 10 });
    const id = new ObjectId(a.id);
    const resultados = await Promise.allSettled([
      e.servicio.confirmar("ana", e.nodo._id, id),
      e.servicio.confirmar("ana2", e.nodo._id, id),
    ]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(resultados.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(e.escrituras.filter((x) => x.valor === 1)).toHaveLength(1);
  });

  it("no se puede confirmar dos veces ni algo que no está pendiente", async () => {
    const e = escenario();
    const a = await pedirYConfirmar(e);
    await expect(e.servicio.confirmar("ana", e.nodo._id, new ObjectId(a.id))).rejects.toMatchObject(
      { codigo: "solicitud_no_vigente" },
    );
    expect(e.escrituras).toHaveLength(1);
  });

  it("una solicitud vencida no manda nada: queda «expirada»", async () => {
    const e = escenario();
    const a = await e.servicio.solicitar("ana", e.nodo._id, { duracionS: 10 });
    e.avanzar(VIGENCIA_CONFIRMACION_S + 1);
    await expect(e.servicio.confirmar("ana", e.nodo._id, new ObjectId(a.id))).rejects.toMatchObject(
      { codigo: "solicitud_expirada" },
    );
    expect(e.escrituras).toEqual([]);
    expect(e.acciones[0]?.estado).toBe("expirada");
    // Y el actuador queda libre para pedir otro pulso.
    await e.servicio.solicitar("ana", e.nodo._id, { duracionS: 10 });
  });

  it("si el agua cambió desde que se pidió, se vuelve a mirar y se rechaza sin mandar nada", async () => {
    const e = escenario();
    const a = await e.servicio.solicitar("ana", e.nodo._id, { duracionS: 10 });
    e.estadoAgua("critico");
    const error = await e.servicio.confirmar("ana", e.nodo._id, new ObjectId(a.id)).catch((x) => x);
    expect(error).toMatchObject({ codigo: "bloqueado" });
    expect(error.message).toMatch(/fuera de rango/);
    expect(e.escrituras).toEqual([]);
    expect(e.acciones[0]).toMatchObject({ estado: "rechazada" });
    expect(e.eventos[0]?.severidad).toBe("atencion");
    expect(e.eventos[0]?.mensaje).toMatch(/Se rechazó el pulso/);
  });

  it("si Blynk no recibe la orden: 503, queda «fallida» y el registro dice que no se activó nada desde Atl", async () => {
    const e = escenario();
    const a = await e.servicio.solicitar("ana", e.nodo._id, { duracionS: 10 });
    e.control.falla = true;
    const error = await e.servicio.confirmar("ana", e.nodo._id, new ObjectId(a.id)).catch((x) => x);
    expect(error).toBeInstanceOf(ServicioNoDisponible);
    expect(error.message).toContain("No se activó nada desde Atl");
    expect(e.acciones[0]?.estado).toBe("fallida");
    expect(e.eventos[0]?.mensaje).toMatch(/Blynk no la recibió/);
    expect(e.escrituras).toEqual([]);
    // La acción fallida no ocupa el actuador ni cuenta como pulso para el enfriamiento.
    e.control.falla = false;
    await e.servicio.solicitar("ana", e.nodo._id, { duracionS: 10 });
  });

  it("un integrante no confirma y un ajeno no ve la solicitud", async () => {
    const e = escenario();
    const a = await e.servicio.solicitar("ana", e.nodo._id, { duracionS: 10 });
    await expect(
      e.servicio.confirmar("beto", e.nodo._id, new ObjectId(a.id)),
    ).rejects.toBeInstanceOf(SinPermiso);
    await expect(
      e.servicio.confirmar("intruso", e.nodo._id, new ObjectId(a.id)),
    ).rejects.toBeInstanceOf(NoEncontrado);
    await expect(e.servicio.confirmar("ana", e.nodo._id, new ObjectId())).rejects.toBeInstanceOf(
      NoEncontrado,
    );
    expect(e.escrituras).toEqual([]);
  });
});

describe("cancelar y detener", () => {
  it("cancelar deja la solicitud en «cancelada» sin mandar nada", async () => {
    const e = escenario();
    const a = await e.servicio.solicitar("ana", e.nodo._id, { duracionS: 10 });
    const r = await e.servicio.cancelar("ana", e.nodo._id, new ObjectId(a.id));
    expect(r.estado).toBe("cancelada");
    expect(e.escrituras).toEqual([]);
    await expect(e.servicio.cancelar("ana", e.nodo._id, new ObjectId(a.id))).rejects.toMatchObject({
      codigo: "solicitud_no_vigente",
    });
  });

  it("detener manda el 0 ANTES de marcar nada y deja el pulso «detenida»", async () => {
    const e = escenario();
    await pedirYConfirmar(e, 30);
    e.avanzar(5);
    const r = await e.servicio.detener("ana", e.nodo._id);
    expect(r?.estado).toBe("detenida");
    expect(e.escrituras).toEqual([
      { pin: "v8", valor: 1 },
      { pin: "v8", valor: 0 },
    ]);
    expect(e.eventos.at(-1)?.mensaje).toMatch(
      /antes de tiempo, a petición de una persona responsable/,
    );
    expect(e.acciones[0]?.automatica).toBe(false);
  });

  it("si Blynk no recibe el «apagar», el pulso sigue «en curso» (nunca se dice «detenido» sin haberlo mandado)", async () => {
    const e = escenario();
    await pedirYConfirmar(e, 30);
    e.control.falla = true;
    await expect(e.servicio.detener("ana", e.nodo._id)).rejects.toBeInstanceOf(
      ServicioNoDisponible,
    );
    expect(e.acciones[0]?.estado).toBe("en_curso");
    e.control.falla = false;
    expect((await e.servicio.detener("ana", e.nodo._id))?.estado).toBe("detenida");
  });

  it("detener una solicitud pendiente la cancela; sin nada activo, 409", async () => {
    const e = escenario();
    await expect(e.servicio.detener("ana", e.nodo._id)).rejects.toMatchObject({
      codigo: "sin_accion",
    });
    await e.servicio.solicitar("ana", e.nodo._id, { duracionS: 10 });
    expect((await e.servicio.detener("ana", e.nodo._id))?.estado).toBe("cancelada");
    expect(e.escrituras).toEqual([]);
  });
});

describe("reaccionar (la regla de seguridad)", () => {
  const cambio = (e: Escenario) => ({ nodo: e.nodo, ultimo: e.nodo.ultimo as UltimoNodo });

  it.each([
    ["fuera_de_rango", false, "el pH salió del rango"],
    ["critico", false, "el pH salió del rango"],
    ["revisar_sensor", false, "la lectura del pH no es confiable"],
    ["en_rango", true, "el nodo dejó de enviar datos"],
  ] as const)(
    "detiene el pulso en curso cuando el estado pasa a %s (sin datos: %s)",
    async (estado, sin, motivo) => {
      const e = escenario();
      await pedirYConfirmar(e, 30);
      e.estadoAgua(estado, sin);
      await e.servicio.reaccionar(cambio(e));
      expect(e.escrituras.at(-1)).toEqual({ pin: "v8", valor: 0 });
      expect(e.acciones[0]).toMatchObject({ estado: "detenida", automatica: true });
      expect(e.eventos.at(-1)?.severidad).toBe("atencion");
      expect(e.eventos.at(-1)?.autor_uid).toBeNull();
      expect(e.eventos.at(-1)?.mensaje).toBe(
        `Se detuvo «Bomba de cloro» (simulado) por seguridad: ${motivo}.`,
      );
    },
  );

  it("es idempotente: reintentar (o una muestra más) no manda un segundo «apagar»", async () => {
    const e = escenario();
    await pedirYConfirmar(e, 30);
    e.estadoAgua("critico");
    await e.servicio.reaccionar(cambio(e));
    await e.servicio.reaccionar(cambio(e));
    expect(e.escrituras.filter((x) => x.valor === 0)).toHaveLength(1);
    expect(e.eventos.filter((x) => x.datos.estado === "detenida")).toHaveLength(1);
  });

  it("con el agua en rango o en atención, no toca el pulso", async () => {
    const e = escenario();
    await pedirYConfirmar(e, 30);
    for (const estado of ["en_rango", "atencion"] as const) {
      e.estadoAgua(estado);
      await e.servicio.reaccionar(cambio(e));
    }
    expect(e.escrituras).toEqual([{ pin: "v8", valor: 1 }]);
    expect(e.acciones[0]?.estado).toBe("en_curso");
  });

  it("sin auto_detener, o sin pulso en curso, no hace nada; una solicitud pendiente no se «detiene»", async () => {
    const e = escenario();
    e.estadoAgua("critico");
    await e.servicio.reaccionar(cambio(e)); // nada que detener
    e.estadoAgua("en_rango");
    await e.servicio.solicitar("ana", e.nodo._id, { duracionS: 10 }); // pendiente
    e.estadoAgua("critico");
    await e.servicio.reaccionar(cambio(e));
    expect(e.acciones[0]?.estado).toBe("pendiente");
    expect(e.escrituras).toEqual([]);

    const f = escenario();
    (f.nodo.actuador as ConfigActuador).auto_detener = false;
    await pedirYConfirmar(f, 30);
    f.estadoAgua("critico");
    await f.servicio.reaccionar(cambio(f));
    expect(f.acciones[0]?.estado).toBe("en_curso");
  });

  it("si Blynk no recibe el «apagar», el error sube (para que la ingesta reintente) y el pulso sigue «en curso»", async () => {
    const e = escenario();
    await pedirYConfirmar(e, 30);
    e.estadoAgua("critico");
    e.control.falla = true;
    await expect(e.servicio.reaccionar(cambio(e))).rejects.toThrow("Blynk caído");
    expect(e.acciones[0]?.estado).toBe("en_curso");
    expect(e.logs.error).toHaveLength(1);
    e.control.falla = false;
    await e.servicio.reaccionar(cambio(e));
    expect(e.acciones[0]?.estado).toBe("detenida");
  });
});

describe("barrido", () => {
  it("apaga el relevador cuando el pulso llega a su fin y lo deja «terminada»", async () => {
    const e = escenario();
    await pedirYConfirmar(e, 20);
    e.avanzar(19);
    await e.servicio.barrido();
    expect(e.acciones[0]?.estado).toBe("en_curso"); // todavía no
    e.avanzar(2);
    await e.servicio.barrido();
    expect(e.acciones[0]?.estado).toBe("terminada");
    expect(e.escrituras).toEqual([
      { pin: "v8", valor: 1 },
      { pin: "v8", valor: 0 },
    ]);
    expect(e.eventos.at(-1)?.mensaje).toBe(
      "Pulso de 20 s terminado: se mandó apagar «Bomba de cloro» (simulado).",
    );
    await e.servicio.barrido();
    expect(e.escrituras.filter((x) => x.valor === 0)).toHaveLength(1); // no se repite
  });

  it("si Blynk no responde, el pulso sigue «en curso» y el siguiente barrido insiste", async () => {
    const e = escenario();
    await pedirYConfirmar(e, 10);
    e.avanzar(11);
    e.control.falla = true;
    await e.servicio.barrido();
    expect(e.acciones[0]?.estado).toBe("en_curso");
    expect(e.logs.error).toHaveLength(1);
    e.control.falla = false;
    await e.servicio.barrido();
    expect(e.acciones[0]?.estado).toBe("terminada");
  });

  it("vence las solicitudes sin confirmar", async () => {
    const e = escenario();
    await e.servicio.solicitar("ana", e.nodo._id, { duracionS: 10 });
    e.avanzar(VIGENCIA_CONFIRMACION_S + 1);
    await e.servicio.barrido();
    expect(e.acciones[0]?.estado).toBe("expirada");
    expect(e.escrituras).toEqual([]);
    expect(e.eventos.at(-1)?.mensaje).toMatch(/venció sin confirmarse/);
  });

  it("tras un pulso, el enfriamiento impide otro hasta que pase el tiempo", async () => {
    const e = escenario();
    await pedirYConfirmar(e, 10);
    e.avanzar(11);
    await e.servicio.barrido();
    await expect(e.servicio.solicitar("ana", e.nodo._id, { duracionS: 10 })).rejects.toMatchObject({
      codigo: "bloqueado",
    });
    e.avanzar(300);
    await e.servicio.solicitar("ana", e.nodo._id, { duracionS: 10 });
  });
});

describe("estado", () => {
  it("muestra la configuración, lo reciente y por qué no se puede, sin ids de personas", async () => {
    const e = escenario();
    await pedirYConfirmar(e, 20);
    const r = await e.servicio.estado("beto", e.nodo._id);
    expect(r.actuador?.nombre).toBe("Bomba de cloro");
    expect(r.activa?.estado).toBe("en_curso");
    expect(r.bloqueos.map((b) => b.codigo)).toEqual(["pulso_en_curso"]);
    expect(r.puede_solicitar).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/ana|uid/);
  });

  it("puede_solicitar solo es verdadero para un responsable cuando no hay nada que lo impida", async () => {
    const e = escenario();
    expect((await e.servicio.estado("ana", e.nodo._id)).puede_solicitar).toBe(true);
    expect((await e.servicio.estado("beto", e.nodo._id)).puede_solicitar).toBe(false); // integrante
    e.estadoAgua("critico");
    expect((await e.servicio.estado("ana", e.nodo._id)).puede_solicitar).toBe(false);
  });

  it("un nodo sin actuador lo dice, sin inventar controles", async () => {
    const e = escenario({ habilitado: false });
    const r = await e.servicio.estado("ana", e.nodo._id);
    expect(r.actuador).toBeNull();
    expect(r.bloqueos[0]?.codigo).toBe("sin_actuador");
    expect(r.puede_solicitar).toBe(false);
  });
});

describe("textos", () => {
  it("ningún mensaje de un evento dice «potable», «seguro» ni que el agua «quedó bien»", async () => {
    const e = escenario();
    await pedirYConfirmar(e, 20);
    e.avanzar(21);
    await e.servicio.barrido();
    const a = await e.servicio.solicitar("ana", e.nodo._id, { duracionS: 10 }).catch(() => null);
    void a;
    for (const ev of e.eventos) {
      expect(ev.mensaje).not.toMatch(/potable|segur[oa]s?\b|quedó bien|clorad[oa]/i);
    }
  });
});
