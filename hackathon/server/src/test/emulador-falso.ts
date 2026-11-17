import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Doble mínimo del emulador de Auth de Firebase. Con el emulador activo, firebase-admin no solo
 * lee el token: también le pregunta al emulador por el usuario (`accounts:lookup`) para saber si
 * está deshabilitado o si su sesión fue revocada. Esto contesta que todo está bien, así las
 * pruebas de verificación corren sin Docker ni red.
 */
export async function iniciarEmuladorFalso(puerto = 0) {
  const servidor = createServer((req, res) => {
    const trozos: Buffer[] = [];
    req.on("data", (t: Buffer) => trozos.push(t));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url?.includes("accounts:lookup")) {
        let uid = "";
        try {
          uid =
            (JSON.parse(Buffer.concat(trozos).toString()) as { localId?: string[] }).localId?.[0] ??
            "";
        } catch {
          // Cuerpo ilegible: se contesta con un usuario vacío y la verificación fallará sola.
        }
        res.end(
          JSON.stringify({
            kind: "identitytoolkit#GetAccountInfoResponse",
            users: [{ localId: uid, validSince: "0", disabled: false, emailVerified: true }],
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((ok) => servidor.listen(puerto, "127.0.0.1", ok));
  const { port } = servidor.address() as AddressInfo;
  return {
    host: `127.0.0.1:${port}`,
    cerrar: () => new Promise<void>((ok) => servidor.close(() => ok())),
  };
}
