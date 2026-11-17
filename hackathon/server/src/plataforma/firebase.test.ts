import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { iniciarEmuladorFalso } from "../test/emulador-falso.ts";
import { crearVerificadorFirebase, prepararEntornoFirebase, tokenDeEmulador } from "./firebase.ts";

const PROYECTO = "atl-prueba-123";
let emulador = { projectId: PROYECTO, usarEmulador: true, hostEmulador: "127.0.0.1:9099" };
const real = { projectId: PROYECTO, usarEmulador: false, hostEmulador: "127.0.0.1:9099" };
let apagarEmulador: () => Promise<void> = async () => {};

beforeAll(async () => {
  const falso = await iniciarEmuladorFalso();
  emulador = { ...emulador, hostEmulador: falso.host };
  apagarEmulador = falso.cerrar;
});
afterAll(async () => {
  await apagarEmulador();
});

afterEach(() => {
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
});

describe("prepararEntornoFirebase", () => {
  it("con emulador fija el host; sin él, borra uno suelto del entorno", () => {
    prepararEntornoFirebase(emulador);
    expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBe(emulador.hostEmulador);
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "otro:1";
    prepararEntornoFirebase(real);
    expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBeUndefined();
  });
});

describe("verificador con el emulador (sin red)", () => {
  it("acepta un token sin firma del proyecto y devuelve uid, correo y nombre", async () => {
    const v = crearVerificadorFirebase(emulador);
    const token = tokenDeEmulador({
      projectId: PROYECTO,
      uid: "u1",
      correo: "ana@ejemplo.mx",
      nombre: "Ana",
    });
    expect(await v.verificar(token)).toEqual({
      uid: "u1",
      correo: "ana@ejemplo.mx",
      nombre: "Ana",
    });
  });

  it("sin nombre en el token, el nombre es null", async () => {
    const v = crearVerificadorFirebase(emulador);
    const token = tokenDeEmulador({ projectId: PROYECTO, uid: "u2", correo: "b@ejemplo.mx" });
    expect((await v.verificar(token)).nombre).toBeNull();
  });

  it("rechaza un token de otro proyecto", async () => {
    const v = crearVerificadorFirebase(emulador);
    const token = tokenDeEmulador({ projectId: "otro-proyecto-999", uid: "u1", correo: "a@b.mx" });
    await expect(v.verificar(token)).rejects.toThrow();
  });

  it("rechaza un token vencido", async () => {
    const v = crearVerificadorFirebase(emulador);
    const hace2h = new Date(Date.now() - 2 * 3600_000);
    const token = tokenDeEmulador({ projectId: PROYECTO, uid: "u1", correo: "a@b.mx" }, hace2h, 60);
    await expect(v.verificar(token)).rejects.toThrow();
  });

  it("rechaza basura y cadenas vacías", async () => {
    const v = crearVerificadorFirebase(emulador);
    await expect(v.verificar("no-es-un-jwt")).rejects.toThrow();
    await expect(v.verificar("")).rejects.toThrow();
  });
});

describe("verificador real", () => {
  it("un token sin firma NO se acepta cuando el emulador está apagado", async () => {
    // Es la defensa clave: si el emulador se activara sin querer en producción, cualquiera podría
    // fabricarse un token. Con FIREBASE_USE_EMULATOR=false el token sin firma debe fallar.
    const v = crearVerificadorFirebase(real);
    const token = tokenDeEmulador({ projectId: PROYECTO, uid: "intruso", correo: "x@y.mx" });
    await expect(v.verificar(token)).rejects.toThrow();
  });
});

describe("tokenDeEmulador", () => {
  it("genera tres partes con el encabezado alg:none y los datos pedidos", () => {
    const t = tokenDeEmulador(
      { projectId: PROYECTO, uid: "u1", correo: "a@b.mx" },
      new Date(0),
      60,
    );
    const [h, c, firma] = t.split(".");
    expect(firma).toBe("");
    expect(JSON.parse(Buffer.from(h as string, "base64url").toString())).toEqual({
      alg: "none",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(c as string, "base64url").toString())).toMatchObject({
      aud: PROYECTO,
      iss: `https://securetoken.google.com/${PROYECTO}`,
      sub: "u1",
      email: "a@b.mx",
      email_verified: true,
      exp: 60,
    });
  });
});
