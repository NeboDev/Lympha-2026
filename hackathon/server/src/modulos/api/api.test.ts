import { describe, expect, it } from "vitest";
import { crearApiFalsa, TOKEN_BLYNK } from "../../test/api-falsa.ts";

const ID_FALSO = "0123456789abcdef01234567";
const PUNTOS = [
  { valor: 4, mv: 177.48 },
  { valor: 7, mv: 0 },
];

/** Ana crea una comunidad y da de alta un nodo; Beto es integrante; Carla no es de nadie. */
async function escenario(opciones: Parameters<typeof crearApiFalsa>[0] = {}) {
  const api = crearApiFalsa(opciones);
  const c = await api.pedir("token-ana", "POST", "/api/comunidades", {
    nombre: "Primaria X",
    tipo: "escuela",
  });
  const comunidadId = c.json().id as string;
  const n = await api.pedir("token-ana", "POST", `/api/comunidades/${comunidadId}/nodos`, {
    nombre: "Tinaco azotea",
    token_blynk: TOKEN_BLYNK,
  });
  const nodoId = n.json().id as string;
  api.comunidades[0]?.miembros.push({ uid: "uid-beto", rol: "integrante" });
  return { ...api, comunidadId, nodoId };
}

const RUTAS_ESPERADAS = [
  "GET /api/salud",
  "GET /api/yo",
  "POST /api/comunidades",
  "GET /api/comunidades/:id/nodos",
  "POST /api/comunidades/:id/nodos",
  "POST /api/comunidades/:id/telegram/vinculo",
  "GET /api/nodos/:id",
  "GET /api/nodos/:id/muestras",
  "GET /api/nodos/:id/eventos",
  "POST /api/nodos/:id/bitacora",
  "GET /api/nodos/:id/calibraciones",
  "POST /api/nodos/:id/calibraciones",
  "GET /api/nodos/:id/reportes",
  "POST /api/nodos/:id/reportes",
];

describe("autenticación en todas las rutas de usuario", () => {
  it("las rutas registradas son exactamente las esperadas (una ruta nueva obliga a declararla aquí)", async () => {
    const api = crearApiFalsa();
    await api.app.ready();
    expect([...api.rutas].sort()).toEqual([...RUTAS_ESPERADAS].sort());
  });

  it("toda ruta, menos /api/salud, rechaza sin token y con un token inválido (401), sin revelar nada", async () => {
    const api = crearApiFalsa();
    await api.app.ready();
    const protegidas = RUTAS_ESPERADAS.filter((r) => r !== "GET /api/salud");
    expect(protegidas.length).toBe(RUTAS_ESPERADAS.length - 1);
    for (const ruta of protegidas) {
      const [metodo, plantilla] = ruta.split(" ") as ["GET" | "POST", string];
      const url = plantilla.replace(":id", ID_FALSO);
      for (const token of [null, "token-que-no-existe"]) {
        const r = await api.pedir(token, metodo, url, metodo === "POST" ? {} : undefined);
        expect(r.statusCode, `${ruta} con ${token}`).toBe(401);
        expect(r.json()).toEqual({
          error: "no_autenticado",
          mensaje: "Hace falta iniciar sesión.",
        });
        expect(r.headers["www-authenticate"]).toBe("Bearer");
      }
    }
  });

  it("la autenticación va antes que la validación: un cuerpo inválido sin token es 401, no 400", async () => {
    const api = crearApiFalsa();
    const r = await api.pedir(null, "POST", "/api/comunidades", { basura: true });
    expect(r.statusCode).toBe(401);
  });

  it("/api/salud es pública", async () => {
    const api = crearApiFalsa();
    const r = await api.pedir(null, "GET", "/api/salud");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, mongo: true, blynk: true });
  });

  it("el usuario de demostración entra con su token fijo y queda marcado como demo", async () => {
    const api = crearApiFalsa({ demoToken: "un-secreto-de-demo-largo" });
    const r = await api.pedir("un-secreto-de-demo-largo", "GET", "/api/yo");
    expect(r.statusCode).toBe(200);
    expect(r.json().usuario).toMatchObject({ id: "demo", demo: true });
    expect((await api.pedir("demo", "GET", "/api/yo")).statusCode).toBe(401);
  });
});

/** Cada ruta que recibe el id de una comunidad o de un nodo, con el rol mínimo que exige. */
const RUTAS_CON_ID = [
  {
    familia: "comunidad",
    metodo: "GET",
    ruta: (id: string) => `/api/comunidades/${id}/nodos`,
    minimo: "integrante",
  },
  {
    familia: "comunidad",
    metodo: "POST",
    ruta: (id: string) => `/api/comunidades/${id}/nodos`,
    cuerpo: { nombre: "Otro nodo", token_blynk: TOKEN_BLYNK },
    minimo: "responsable",
  },
  {
    familia: "comunidad",
    metodo: "POST",
    ruta: (id: string) => `/api/comunidades/${id}/telegram/vinculo`,
    minimo: "responsable",
  },
  {
    familia: "nodo",
    metodo: "GET",
    ruta: (id: string) => `/api/nodos/${id}`,
    minimo: "integrante",
  },
  {
    familia: "nodo",
    metodo: "GET",
    ruta: (id: string) => `/api/nodos/${id}/muestras`,
    minimo: "integrante",
  },
  {
    familia: "nodo",
    metodo: "GET",
    ruta: (id: string) => `/api/nodos/${id}/eventos`,
    minimo: "integrante",
  },
  {
    familia: "nodo",
    metodo: "POST",
    ruta: (id: string) => `/api/nodos/${id}/bitacora`,
    cuerpo: { texto: "hola" },
    minimo: "integrante",
  },
  {
    familia: "nodo",
    metodo: "GET",
    ruta: (id: string) => `/api/nodos/${id}/calibraciones`,
    minimo: "integrante",
  },
  {
    familia: "nodo",
    metodo: "POST",
    ruta: (id: string) => `/api/nodos/${id}/calibraciones`,
    cuerpo: { parametro: "ph", puntos: PUNTOS },
    minimo: "responsable",
  },
  {
    familia: "nodo",
    metodo: "GET",
    ruta: (id: string) => `/api/nodos/${id}/reportes`,
    minimo: "integrante",
  },
  {
    familia: "nodo",
    metodo: "POST",
    ruta: (id: string) => `/api/nodos/${id}/reportes`,
    minimo: "integrante",
  },
] as const;

describe("acceso cruzado entre comunidades", () => {
  it("las pruebas de acceso cubren todas las rutas con id", async () => {
    const api = crearApiFalsa();
    await api.app.ready();
    const conId = RUTAS_ESPERADAS.filter((r) => r.includes(":id"));
    const cubiertas = RUTAS_CON_ID.map((r) => {
      const url = r.ruta(":id");
      return `${r.metodo} ${url}`;
    });
    expect(cubiertas.sort()).toEqual(conId.sort());
  });

  for (const r of RUTAS_CON_ID) {
    const nombre = `${r.metodo} ${r.ruta(":id")}`;
    const cuerpo = "cuerpo" in r ? r.cuerpo : undefined;

    it(`${nombre}: una persona ajena recibe el mismo 404 que un id que no existe`, async () => {
      const e = await escenario();
      const id = r.familia === "comunidad" ? e.comunidadId : e.nodoId;
      const ajeno = await e.pedir("token-carla", r.metodo, r.ruta(id), cuerpo);
      const noExiste = await e.pedir("token-carla", r.metodo, r.ruta(ID_FALSO), cuerpo);
      expect(ajeno.statusCode).toBe(404);
      expect(ajeno.json()).toEqual(noExiste.json());
      // El responsable de verdad sí accede: el 404 no es un error general de la ruta.
      expect((await e.pedir("token-ana", r.metodo, r.ruta(id), cuerpo)).statusCode).toBeLessThan(
        300,
      );
    });

    it(`${nombre}: un id mal formado es 404, no 400`, async () => {
      const e = await escenario();
      const r2 = await e.pedir("token-ana", r.metodo, r.ruta("no-es-un-id"), cuerpo);
      expect(r2.statusCode).toBe(404);
      expect(r2.json().error).toBe("no_encontrado");
    });

    if (r.minimo === "responsable") {
      it(`${nombre}: un integrante recibe 403`, async () => {
        const e = await escenario();
        const id = r.familia === "comunidad" ? e.comunidadId : e.nodoId;
        const res = await e.pedir("token-beto", r.metodo, r.ruta(id), cuerpo);
        expect(res.statusCode).toBe(403);
        expect(res.json().error).toBe("sin_permiso");
      });
    } else {
      it(`${nombre}: un integrante sí puede`, async () => {
        const e = await escenario();
        const id = r.familia === "comunidad" ? e.comunidadId : e.nodoId;
        const res = await e.pedir("token-beto", r.metodo, r.ruta(id), cuerpo);
        expect(res.statusCode).toBeLessThan(300);
      });
    }
  }
});

describe("GET /api/yo y comunidades", () => {
  it("devuelve a la persona y solo sus comunidades", async () => {
    const e = await escenario();
    const ana = (await e.pedir("token-ana", "GET", "/api/yo")).json();
    expect(ana.usuario).toEqual({
      id: "uid-ana",
      nombre: "Ana",
      correo: "ana@ejemplo.mx",
      demo: false,
    });
    expect(ana.comunidades).toEqual([
      expect.objectContaining({
        id: e.comunidadId,
        nombre: "Primaria X",
        rol: "responsable",
        telegram: null,
      }),
    ]);
    expect((await e.pedir("token-beto", "GET", "/api/yo")).json().comunidades[0].rol).toBe(
      "integrante",
    );
    expect((await e.pedir("token-carla", "GET", "/api/yo")).json().comunidades).toEqual([]);
  });

  it("registra a la persona la primera vez que entra", async () => {
    const e = await escenario();
    expect(e.usuarios.map((u) => u.uid)).toContain("uid-ana");
  });

  it("crear una comunidad responde 201, usa «otro» por defecto y valida el cuerpo", async () => {
    const api = crearApiFalsa();
    const ok = await api.pedir("token-ana", "POST", "/api/comunidades", {
      nombre: "Comité del pozo",
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({
      nombre: "Comité del pozo",
      tipo: "otro",
      rol: "responsable",
    });
    for (const malo of [
      {},
      { nombre: "x" },
      { nombre: "Bien", tipo: "empresa" },
      { nombre: "Bien", extra: 1 },
      { nombre: 5 },
    ]) {
      const r = await api.pedir("token-ana", "POST", "/api/comunidades", malo);
      expect(r.statusCode, JSON.stringify(malo)).toBeGreaterThanOrEqual(400);
      expect(r.statusCode).toBeLessThan(500);
    }
  });
});

describe("nodos", () => {
  it("el alta responde 201 sin token, sin mapeo y avisa si la placa está conectada", async () => {
    const e = await escenario();
    const res = await e.pedir("token-ana", "POST", `/api/comunidades/${e.comunidadId}/nodos`, {
      nombre: "Cisterna",
      token_blynk: TOKEN_BLYNK,
      ubicacion: { texto: "Patio", lat: 19.04, lng: -98.2 },
      parametros: ["ph"],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ nombre: "Cisterna", conectado: true, rol: "responsable" });
    expect(res.body).not.toContain(TOKEN_BLYNK);
    expect(res.body).not.toMatch(/token|blynk|mapeo|cifrado/i);
    expect(e.nodos.at(-1)?.blynk.token_cifrado).toBe(`cifrado-${TOKEN_BLYNK.length}`);
  });

  it("un token que Blynk no reconoce es 422 y un nombre repetido es 409", async () => {
    const e = await escenario();
    e.estado.token = "invalido";
    const r1 = await e.pedir("token-ana", "POST", `/api/comunidades/${e.comunidadId}/nodos`, {
      nombre: "Otro",
      token_blynk: TOKEN_BLYNK,
    });
    expect(r1.statusCode).toBe(422);
    expect(r1.json().error).toBe("token_blynk_invalido");
    e.estado.token = "conectado";
    const r2 = await e.pedir("token-ana", "POST", `/api/comunidades/${e.comunidadId}/nodos`, {
      nombre: "Tinaco azotea",
      token_blynk: TOKEN_BLYNK,
    });
    expect(r2.statusCode).toBe(409);
  });

  it("el detalle muestra parámetros con su norma y nunca el token", async () => {
    const e = await escenario();
    const r = await e.pedir("token-beto", "GET", `/api/nodos/${e.nodoId}`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      id: e.nodoId,
      nombre: "Tinaco azotea",
      conexion: "sin_lecturas",
      rol: "integrante",
      parametros: [{ id: "ph", norma: { min: 6.5, max: 8.5 } }],
    });
    expect(r.body).not.toMatch(/token|blynk|mapeo|cifrado/i);
  });

  it("lista los nodos de la comunidad", async () => {
    const e = await escenario();
    const r = await e.pedir("token-ana", "GET", `/api/comunidades/${e.comunidadId}/nodos`);
    expect(r.json().nodos.map((n: { nombre: string }) => n.nombre)).toEqual(["Tinaco azotea"]);
  });

  it("la serie valida fechas y paso, y entrega los puntos agregados", async () => {
    const e = await escenario();
    e.estado.serie = [
      { ts: new Date("2026-11-19T15:00:00Z"), n: 4, v: { ph: { prom: 7, min: 6.9, max: 7.1 } } },
    ];
    const ok = await e.pedir("token-ana", "GET", `/api/nodos/${e.nodoId}/muestras?paso=600`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      paso_s: 600,
      parametros: ["ph"],
      puntos: [
        { ts: "2026-11-19T15:00:00.000Z", n: 4, v: { ph: { prom: 7, min: 6.9, max: 7.1 } } },
      ],
    });
    for (const q of [
      "desde=ayer",
      "paso=abc",
      "paso=-5",
      "limite=3",
      "paso=2",
      "paso=60",
      "desde=2026-11-19T15:00:00Z&hasta=2026-11-19T14:00:00Z",
    ]) {
      const r = await e.pedir("token-ana", "GET", `/api/nodos/${e.nodoId}/muestras?${q}`);
      expect(r.statusCode, q).toBeGreaterThanOrEqual(400);
      expect(r.statusCode, q).toBeLessThan(500);
    }
  });

  it("los eventos devuelven alertas y eventos sin exponer a los autores", async () => {
    const e = await escenario();
    e.estado.eventos = [
      {
        ts: new Date("2026-11-19T14:00:00Z"),
        tipo: "bitacora",
        mensaje: "Se lavó el tinaco.",
        autor_uid: "uid-ana",
      },
    ];
    const r = await e.pedir("token-ana", "GET", `/api/nodos/${e.nodoId}/eventos`);
    expect(r.statusCode).toBe(200);
    expect(r.json().eventos).toEqual([
      {
        ts: "2026-11-19T14:00:00.000Z",
        tipo: "bitacora",
        mensaje: "Se lavó el tinaco.",
        propia: true,
      },
    ]);
    expect(r.body).not.toContain("uid-ana");
    const deBeto = await e.pedir("token-beto", "GET", `/api/nodos/${e.nodoId}/eventos`);
    expect(deBeto.json().eventos[0].propia).toBe(false);
  });
});

describe("bitácora y calibraciones", () => {
  it("una nota queda guardada con su autor y se valida su largo", async () => {
    const e = await escenario();
    const ok = await e.pedir("token-beto", "POST", `/api/nodos/${e.nodoId}/bitacora`, {
      texto: " Se cambió la sonda ",
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().texto).toBe("Se cambió la sonda");
    expect(e.eventos.at(-1)).toMatchObject({ tipo: "bitacora", autor_uid: "uid-beto" });
    for (const malo of [
      { texto: "" },
      { texto: "   " },
      { texto: "x".repeat(501) },
      { texto: "x".repeat(2001) },
      {},
      { texto: "a", extra: 1 },
    ]) {
      const r = await e.pedir("token-beto", "POST", `/api/nodos/${e.nodoId}/bitacora`, malo);
      expect(r.statusCode, JSON.stringify(malo).slice(0, 30)).toBeGreaterThanOrEqual(400);
      expect(r.statusCode).toBeLessThan(500);
    }
  });

  it("el responsable registra una calibración y se puede listar", async () => {
    const e = await escenario();
    const r = await e.pedir("token-ana", "POST", `/api/nodos/${e.nodoId}/calibraciones`, {
      parametro: "ph",
      puntos: PUNTOS,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      parametro: "ph",
      diagnostico: "buena",
      temp_c: 25,
      offset_mv: 0,
    });
    expect(r.body).not.toContain("uid-ana");
    const lista = await e.pedir("token-beto", "GET", `/api/nodos/${e.nodoId}/calibraciones`);
    expect(lista.json().calibraciones).toHaveLength(1);
    expect(lista.body).not.toContain("autor");
    expect(e.eventos.at(-1)).toMatchObject({ tipo: "calibracion" });
  });

  it("rechaza calibraciones imposibles", async () => {
    const e = await escenario();
    const malos = [
      { parametro: "turbidez", puntos: PUNTOS },
      { parametro: "ph", puntos: [PUNTOS[0]] },
      { parametro: "ph", puntos: [PUNTOS[0], PUNTOS[0]] },
      { parametro: "ph", puntos: PUNTOS, temp_c: 90 },
      { parametro: "ph", puntos: [{ valor: "4", mv: 1 }, PUNTOS[1]] },
    ];
    for (const malo of malos) {
      const r = await e.pedir("token-ana", "POST", `/api/nodos/${e.nodoId}/calibraciones`, malo);
      expect(r.statusCode, JSON.stringify(malo)).toBeGreaterThanOrEqual(400);
      expect(r.statusCode).toBeLessThan(500);
    }
    expect(e.calibraciones).toHaveLength(0);
  });
});

describe("POST /api/nodos/:id/reportes", () => {
  it("devuelve el PDF sin guardarlo en cachés, con 7 días por defecto y el nombre de quien lo pide", async () => {
    const e = await escenario();
    const r = await e.pedir("token-beto", "POST", `/api/nodos/${e.nodoId}/reportes`);
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("application/pdf");
    expect(r.headers["content-disposition"]).toBe(
      'attachment; filename="reporte-prueba-2026-11-19.pdf"',
    );
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const p = e.reportesPedidos[0];
    expect(p?.nodoId).toBe(e.nodoId);
    expect(p?.por).toBe("Beto");
    expect((p?.hasta.getTime() ?? 0) - (p?.desde.getTime() ?? 0)).toBe(7 * 86_400_000);
  });

  it("acepta `dias` o un periodo exacto, pero no las dos cosas ni uno a medias", async () => {
    const e = await escenario();
    const ruta = `/api/nodos/${e.nodoId}/reportes`;
    const hasta = "2026-11-19T15:00:00Z";
    expect((await e.pedir("token-ana", "POST", ruta, { dias: 30 })).statusCode).toBe(200);
    expect(
      (await e.pedir("token-ana", "POST", ruta, { desde: "2026-11-12T15:00:00Z", hasta }))
        .statusCode,
    ).toBe(200);
    expect(e.reportesPedidos.at(-1)?.desde).toEqual(new Date("2026-11-12T15:00:00Z"));
    for (const malo of [
      { dias: 7, desde: "2026-11-12T15:00:00Z", hasta },
      { desde: "2026-11-12T15:00:00Z" },
      { dias: 0 },
      { dias: 1000 },
      { dias: 2.5 },
      { desde: hasta, hasta: "2026-11-12T15:00:00Z" },
      { basura: 1 },
    ]) {
      const r = await e.pedir("token-ana", "POST", ruta, malo);
      expect(r.statusCode, JSON.stringify(malo)).toBeGreaterThanOrEqual(400);
      expect(r.statusCode).toBeLessThan(500);
    }
  });

  it("un fallo interno responde 500 genérico, sin detalles", async () => {
    const e = await escenario({ reporteFalla: true });
    const r = await e.pedir("token-ana", "POST", `/api/nodos/${e.nodoId}/reportes`);
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: "error_interno" });
    expect(r.body).not.toContain("detalle que no debe salir");
  });
});

describe("GET /api/nodos/:id/reportes", () => {
  it("lista los reportes anteriores con su resumen y su huella corta", async () => {
    const e = await escenario();
    expect((await e.pedir("token-ana", "GET", `/api/nodos/${e.nodoId}/reportes`)).json()).toEqual({
      reportes: [],
    });
    await e.pedir("token-beto", "POST", `/api/nodos/${e.nodoId}/reportes`, { dias: 30 });
    const r = await e.pedir("token-ana", "GET", `/api/nodos/${e.nodoId}/reportes?limite=5`);
    expect(r.statusCode).toBe(200);
    expect(r.json().reportes).toEqual([
      expect.objectContaining({ generado_por: "Beto", huella: "abcdef012345" }),
    ]);
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("rechaza un límite que no es un número positivo", async () => {
    const e = await escenario();
    for (const q of ["limite=0", "limite=abc", "limite=-1", "otro=1"]) {
      const r = await e.pedir("token-ana", "GET", `/api/nodos/${e.nodoId}/reportes?${q}`);
      expect(r.statusCode, q).toBe(400);
    }
  });
});

describe("POST /api/comunidades/:id/telegram/vinculo", () => {
  it("el responsable obtiene un enlace de un solo uso", async () => {
    const e = await escenario();
    const r = await e.pedir(
      "token-ana",
      "POST",
      `/api/comunidades/${e.comunidadId}/telegram/vinculo`,
    );
    expect(r.statusCode).toBe(200);
    expect(r.json().enlace).toBe(`https://t.me/lympha26_bot?start=enlace-de-${e.comunidadId}`);
    expect(r.json().expira).toBe("2026-11-19T15:10:00.000Z");
  });

  it("sin Telegram configurado, 503 con un código claro", async () => {
    const e = await escenario({ telegram: false });
    const r = await e.pedir(
      "token-ana",
      "POST",
      `/api/comunidades/${e.comunidadId}/telegram/vinculo`,
    );
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toBe("telegram_no_configurado");
  });
});

describe("cabeceras y CORS", () => {
  it("las respuestas autenticadas no se guardan en caché", async () => {
    const e = await escenario();
    for (const url of [
      "/api/yo",
      `/api/nodos/${e.nodoId}`,
      `/api/comunidades/${e.comunidadId}/nodos`,
    ]) {
      expect((await e.pedir("token-ana", "GET", url)).headers["cache-control"], url).toBe(
        "no-store",
      );
    }
    // Los errores tampoco.
    expect((await e.pedir(null, "GET", "/api/yo")).headers["cache-control"]).toBe("no-store");
  });

  it("el preflight de un origen permitido responde sin pedir token; uno ajeno no recibe permisos", async () => {
    const api = crearApiFalsa();
    const ok = await api.app.inject({
      method: "OPTIONS",
      url: "/api/yo",
      headers: { origin: "http://localhost:5173" },
    });
    expect(ok.statusCode).toBe(204);
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(ok.headers["access-control-allow-headers"]).toContain("Authorization");
    expect(ok.headers["access-control-expose-headers"]).toBe("Content-Disposition");
    const ajeno = await api.app.inject({
      method: "OPTIONS",
      url: "/api/yo",
      headers: { origin: "https://malo.example" },
    });
    expect(ajeno.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("una ruta que no existe es 404 genérico", async () => {
    const api = crearApiFalsa();
    const r = await api.pedir("token-ana", "GET", "/api/nada");
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: "no_encontrado" });
  });
});
