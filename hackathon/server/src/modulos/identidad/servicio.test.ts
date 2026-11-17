import { describe, expect, it } from "vitest";
import { NoAutenticado } from "../../dominio/errores.ts";
import {
  crearServicioIdentidad,
  type IdentidadVerificada,
  USUARIO_DEMO,
  type VerificadorToken,
} from "./index.ts";

const ANA: IdentidadVerificada = { uid: "uid-ana", correo: "ana@ejemplo.mx", nombre: "Ana" };

function escenario(opciones: { demoToken?: string } = {}) {
  const registrados: IdentidadVerificada[] = [];
  const verificados: string[] = [];
  const verificador: VerificadorToken = {
    async verificar(token) {
      verificados.push(token);
      if (token === "token-de-ana") return ANA;
      throw new Error("el token venció (detalle interno de Firebase)");
    },
  };
  const servicio = crearServicioIdentidad({
    verificador,
    almacen: {
      async registrar(u) {
        registrados.push(u);
      },
    },
    ...(opciones.demoToken ? { demoToken: opciones.demoToken } : {}),
  });
  return { servicio, registrados, verificados };
}

describe("autenticar", () => {
  it("un token válido da la identidad y registra a la persona", async () => {
    const e = escenario();
    const u = await e.servicio.autenticar("Bearer token-de-ana");
    expect(u).toEqual({ ...ANA, demo: false });
    expect(e.registrados).toEqual([ANA]);
  });

  it("acepta «bearer» en minúsculas y espacios de más", async () => {
    const e = escenario();
    expect((await e.servicio.autenticar("  bearer   token-de-ana ")).uid).toBe("uid-ana");
  });

  it("registra una sola vez por proceso mientras no cambien los datos", async () => {
    const e = escenario();
    await e.servicio.autenticar("Bearer token-de-ana");
    await e.servicio.autenticar("Bearer token-de-ana");
    expect(e.registrados).toHaveLength(1);
  });

  it.each([
    ["sin cabecera", undefined],
    ["vacía", ""],
    ["sin esquema", "token-de-ana"],
    ["otro esquema", "Basic abc"],
    ["sin token", "Bearer"],
    ["con dos tokens", "Bearer a b"],
  ])("rechaza la cabecera %s sin consultar a Firebase", async (_nombre, cabecera) => {
    const e = escenario();
    await expect(e.servicio.autenticar(cabecera)).rejects.toBeInstanceOf(NoAutenticado);
    expect(e.verificados).toEqual([]);
  });

  it("rechaza un token enorme sin consultar a Firebase", async () => {
    const e = escenario();
    await expect(e.servicio.autenticar(`Bearer ${"a".repeat(5000)}`)).rejects.toBeInstanceOf(
      NoAutenticado,
    );
    expect(e.verificados).toEqual([]);
  });

  it("un token inválido da siempre el mismo error genérico, sin el detalle de Firebase", async () => {
    const e = escenario();
    const error = await e.servicio.autenticar("Bearer token-malo").catch((x) => x);
    expect(error).toBeInstanceOf(NoAutenticado);
    expect(error.message).toBe("Hace falta iniciar sesión.");
    expect(error.message).not.toMatch(/venció|Firebase/);
    expect(e.registrados).toEqual([]);
  });
});

describe("usuario de demostración", () => {
  const DEMO = "un-secreto-de-demo-largo";

  it("con su token entra como el usuario fijo, sin consultar a Firebase", async () => {
    const e = escenario({ demoToken: DEMO });
    const u = await e.servicio.autenticar(`Bearer ${DEMO}`);
    expect(u).toEqual({ ...USUARIO_DEMO, demo: true });
    expect(e.verificados).toEqual([]);
    expect(e.registrados).toEqual([USUARIO_DEMO]);
  });

  it("un token parecido no entra", async () => {
    const e = escenario({ demoToken: DEMO });
    await expect(e.servicio.autenticar(`Bearer ${DEMO}x`)).rejects.toBeInstanceOf(NoAutenticado);
    await expect(e.servicio.autenticar("Bearer demo")).rejects.toBeInstanceOf(NoAutenticado);
  });

  it("sin token de demostración configurado, nadie entra como demo", async () => {
    const e = escenario();
    await expect(e.servicio.autenticar(`Bearer ${DEMO}`)).rejects.toBeInstanceOf(NoAutenticado);
  });
});
