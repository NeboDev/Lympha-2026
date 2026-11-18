import { describe, expect, it } from "vitest";
import { crearApiFalsa, TOKEN_BLYNK } from "../../test/api-falsa.ts";
import { T0 } from "../../test/falsos.ts";
import type { UltimoNodo } from "../nodos/index.ts";

const CONFIG = {
  habilitado: true,
  nombre: "Bomba de cloro",
  pulso_max_s: 30,
  enfriamiento_s: 300,
  simulado: true,
  auto_detener: true,
};

function ultimo(estado: UltimoNodo["estado"]): UltimoNodo {
  return {
    ts: new Date(T0),
    v: { ph: 7.2 },
    estado,
    estados: {},
    seq: 1,
    sesion: 0,
    estable: true,
    ultimo_cambio: new Date(T0),
    sin_datos: false,
  };
}

/** Ana (responsable) con su comunidad y su nodo; Beto es integrante. El agua está en rango. */
async function escenario(opciones: Parameters<typeof crearApiFalsa>[0] = {}) {
  const api = crearApiFalsa(opciones);
  const c = await api.pedir("token-ana", "POST", "/api/comunidades", { nombre: "Primaria X" });
  const n = await api.pedir("token-ana", "POST", `/api/comunidades/${c.json().id}/nodos`, {
    nombre: "Tinaco azotea",
    token_blynk: TOKEN_BLYNK,
  });
  const nodoId = n.json().id as string;
  api.comunidades[0]?.miembros.push({ uid: "uid-beto", rol: "integrante" });
  (api.nodos[0] as { ultimo: UltimoNodo | null }).ultimo = ultimo("en_rango");
  const ruta = `/api/nodos/${nodoId}/actuador`;
  return {
    ...api,
    nodoId,
    ruta,
    habilitar: () => api.pedir("token-ana", "PUT", ruta, CONFIG),
    pedirPulso: (s = 10) => api.pedir("token-ana", "POST", `${ruta}/pulsos`, { duracion_s: s }),
    agua: (estado: UltimoNodo["estado"]) => {
      (api.nodos[0] as { ultimo: UltimoNodo | null }).ultimo = ultimo(estado);
    },
  };
}

describe("un nodo sin actuador", () => {
  it("lo dice, no ofrece controles y no deja pedir un pulso", async () => {
    const e = await escenario();
    const r = await e.pedir("token-ana", "GET", e.ruta);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      actuador: null,
      activa: null,
      recientes: [],
      puede_solicitar: false,
      bloqueos: [{ codigo: "sin_actuador" }],
    });
    const p = await e.pedirPulso();
    expect(p.statusCode).toBe(422);
    expect(p.json().error).toBe("sin_actuador");
    expect(e.escriturasActuador).toEqual([]);
  });

  it("el nodo lo muestra como `actuador: null` (y no se filtra nada del control)", async () => {
    const e = await escenario();
    expect(
      (await e.pedir("token-beto", "GET", `/api/nodos/${e.nodoId}`)).json().actuador,
    ).toBeNull();
  });
});

describe("configurar", () => {
  it("el responsable lo habilita; el nodo y el estado lo reflejan", async () => {
    const e = await escenario();
    const r = await e.habilitar();
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      actuador: {
        habilitado: true,
        nombre: "Bomba de cloro",
        pin: "v8",
        simulado: true,
        auto_detener: true,
      },
      puede_solicitar: true,
      bloqueos: [],
    });
    const nodo = (await e.pedir("token-beto", "GET", `/api/nodos/${e.nodoId}`)).json();
    expect(nodo.actuador).toEqual({ habilitado: true, nombre: "Bomba de cloro", simulado: true });
  });

  it("un integrante no lo cambia (403); el cuerpo se valida y no admite campos de más (no se elige el pin)", async () => {
    const e = await escenario();
    expect((await e.pedir("token-beto", "PUT", e.ruta, CONFIG)).statusCode).toBe(403);
    const malos = [
      {},
      { ...CONFIG, pin: "v9" },
      { ...CONFIG, habilitado: "si" },
      { ...CONFIG, pulso_max_s: 2.5 },
      { ...CONFIG, nombre: 5 },
      { ...CONFIG, simulado: undefined },
    ];
    for (const malo of malos) {
      const r = await e.pedir("token-ana", "PUT", e.ruta, malo);
      expect(r.statusCode, JSON.stringify(malo)).toBe(400);
    }
    const fuera = await e.pedir("token-ana", "PUT", e.ruta, { ...CONFIG, pulso_max_s: 500 });
    expect(fuera.statusCode).toBe(422);
    expect(fuera.json().error).toBe("pulso_invalido");
    expect(e.nodos[0]?.actuador).toBeUndefined();
  });
});

describe("el flujo de un pulso: pedir → confirmar → detener", () => {
  it("pedirlo NO manda nada a Blynk; confirmarlo manda un 1 al pin v8; detenerlo manda un 0", async () => {
    const e = await escenario();
    await e.habilitar();

    const p = await e.pedirPulso(20);
    expect(p.statusCode).toBe(201);
    expect(p.json()).toMatchObject({
      estado: "pendiente",
      duracion_s: 20,
      simulado: true,
      automatica: false,
    });
    expect(e.escriturasActuador).toEqual([]); // todavía nadie confirmó

    const id = p.json().id as string;
    const c = await e.pedir("token-ana", "POST", `${e.ruta}/pulsos/${id}/confirmar`);
    expect(c.statusCode).toBe(200);
    expect(c.json().estado).toBe("en_curso");
    expect(e.escriturasActuador).toEqual([{ pin: "v8", valor: 1 }]);

    const estado = (await e.pedir("token-beto", "GET", e.ruta)).json();
    expect(estado.activa).toMatchObject({ id, estado: "en_curso" });
    expect(estado.puede_solicitar).toBe(false);

    const d = await e.pedir("token-ana", "POST", `${e.ruta}/detener`);
    expect(d.statusCode).toBe(200);
    expect(d.json().accion.estado).toBe("detenida");
    expect(e.escriturasActuador).toEqual([
      { pin: "v8", valor: 1 },
      { pin: "v8", valor: 0 },
    ]);
    // Todo queda registrado en la línea de tiempo del nodo.
    expect(e.controlFalso.eventos.map((x) => x.datos.estado)).toEqual(["en_curso", "detenida"]);
  });

  it("cancelar una solicitud pendiente no manda nada y deja pedir otra", async () => {
    const e = await escenario();
    await e.habilitar();
    const id = (await e.pedirPulso()).json().id as string;
    const c = await e.pedir("token-ana", "POST", `${e.ruta}/pulsos/${id}/cancelar`);
    expect(c.json().estado).toBe("cancelada");
    expect(e.escriturasActuador).toEqual([]);
    expect((await e.pedirPulso()).statusCode).toBe(201);
  });

  it("no se puede pedir otro pulso mientras hay uno pendiente o en curso (409)", async () => {
    const e = await escenario();
    await e.habilitar();
    await e.pedirPulso();
    const otra = await e.pedirPulso();
    expect(otra.statusCode).toBe(409);
    expect(otra.json().error).toBe("accion_activa");
  });

  it("no se puede confirmar dos veces (409) ni el integrante confirma (403)", async () => {
    const e = await escenario();
    await e.habilitar();
    const id = (await e.pedirPulso()).json().id as string;
    expect(
      (await e.pedir("token-beto", "POST", `${e.ruta}/pulsos/${id}/confirmar`)).statusCode,
    ).toBe(403);
    expect(
      (await e.pedir("token-ana", "POST", `${e.ruta}/pulsos/${id}/confirmar`)).statusCode,
    ).toBe(200);
    const segunda = await e.pedir("token-ana", "POST", `${e.ruta}/pulsos/${id}/confirmar`);
    expect(segunda.statusCode).toBe(409);
    expect(e.escriturasActuador.filter((x) => x.valor === 1)).toHaveLength(1);
  });

  it("detener sin nada en curso es 409", async () => {
    const e = await escenario();
    await e.habilitar();
    const r = await e.pedir("token-ana", "POST", `${e.ruta}/detener`);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("sin_accion");
  });
});

describe("enclavamientos", () => {
  it.each(["fuera_de_rango", "critico", "revisar_sensor"] as const)(
    "con el agua en estado «%s» no se deja pedir un pulso, y dice por qué",
    async (estado) => {
      const e = await escenario();
      await e.habilitar();
      e.agua(estado);
      const r = await e.pedirPulso();
      expect(r.statusCode).toBe(422);
      expect(r.json().error).toBe("bloqueado");
      expect(r.json().mensaje.length).toBeGreaterThan(20);
      expect((await e.pedir("token-ana", "GET", e.ruta)).json()).toMatchObject({
        puede_solicitar: false,
      });
      expect(e.escriturasActuador).toEqual([]);
    },
  );

  it("si el agua sale de rango entre pedirlo y confirmarlo, se rechaza sin mandar nada", async () => {
    const e = await escenario();
    await e.habilitar();
    const id = (await e.pedirPulso()).json().id as string;
    e.agua("critico");
    const r = await e.pedir("token-ana", "POST", `${e.ruta}/pulsos/${id}/confirmar`);
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toBe("bloqueado");
    expect(e.escriturasActuador).toEqual([]);
    expect((await e.pedir("token-ana", "GET", e.ruta)).json().recientes[0].estado).toBe(
      "rechazada",
    );
  });

  it("la duración debe ser entera y no pasar del máximo del nodo", async () => {
    const e = await escenario();
    await e.habilitar();
    // Fuera del máximo del nodo: lo rechaza el servicio (422). Con decimales: ni siquiera es un entero (400).
    for (const s of [0, 31, -1]) {
      const r = await e.pedirPulso(s);
      expect(r.statusCode, String(s)).toBe(422);
    }
    expect((await e.pedirPulso(2.5)).statusCode).toBe(400);
    expect(
      (await e.pedir("token-ana", "POST", `${e.ruta}/pulsos`, { duracion_s: "10" })).statusCode,
    ).toBe(400);
    expect(
      (await e.pedir("token-ana", "POST", `${e.ruta}/pulsos`, { duracion_s: 10, extra: 1 }))
        .statusCode,
    ).toBe(400);
  });
});

describe("cuando Blynk falla", () => {
  it("confirmar responde 503 con una frase clara y la acción queda «fallida»", async () => {
    const e = await escenario({ actuadorFalla: true });
    await e.habilitar();
    const id = (await e.pedirPulso()).json().id as string;
    const r = await e.pedir("token-ana", "POST", `${e.ruta}/pulsos/${id}/confirmar`);
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toBe("blynk_no_responde");
    expect(r.json().mensaje).toContain("No se activó nada desde Atl");
    expect((await e.pedir("token-ana", "GET", e.ruta)).json().recientes[0].estado).toBe("fallida");
  });
});

describe("lo que la API no filtra", () => {
  it("ninguna respuesta del actuador trae ids de personas, el token de Blynk ni el pin que se pidió", async () => {
    const e = await escenario();
    await e.habilitar();
    const id = (await e.pedirPulso()).json().id as string;
    await e.pedir("token-ana", "POST", `${e.ruta}/pulsos/${id}/confirmar`);
    const cuerpos = [
      (await e.pedir("token-beto", "GET", e.ruta)).body,
      (await e.pedir("token-ana", "POST", `${e.ruta}/detener`)).body,
    ];
    for (const c of cuerpos) {
      expect(c).not.toMatch(/uid-|autor|token|solicita_uid|confirma_uid/i);
      expect(c).not.toContain(TOKEN_BLYNK);
    }
  });

  it("las acciones de Atl no usan texto de «potable» ni «seguro»", async () => {
    const e = await escenario();
    await e.habilitar();
    const id = (await e.pedirPulso()).json().id as string;
    await e.pedir("token-ana", "POST", `${e.ruta}/pulsos/${id}/confirmar`);
    await e.pedir("token-ana", "POST", `${e.ruta}/detener`);
    for (const ev of e.controlFalso.eventos)
      expect(ev.mensaje).not.toMatch(/potable|segur[oa]s?\b/i);
  });
});
