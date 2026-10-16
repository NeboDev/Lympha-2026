import { createReadStream, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";

const NOMBRE = /^lympha-[0-9A-Za-z][0-9A-Za-z._+-]{0,31}\.bin$/;

/**
 * Servidor de binarios del OTA para la red local: `GET /fw/lympha-<versión>.bin`. Sin autenticación (el
 * binario no es secreto; la integridad la da el sha256 del comando). Solo sirve archivos con ese nombre dentro
 * de `dirOta`, nunca rutas. En un despliegue real el binario saldrá de S3 por URL prefirmada y esto no se usa.
 */
export function crearServidorOta(dirOta: string): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const nombre = url.pathname.startsWith("/fw/") ? url.pathname.slice(4) : "";
    if (req.method !== "GET" || !NOMBRE.test(nombre)) {
      res.writeHead(404).end();
      return;
    }
    const ruta = join(dirOta, nombre);
    let tamano: number;
    try {
      tamano = statSync(ruta).size;
    } catch {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": tamano,
      "cache-control": "no-store",
    });
    createReadStream(ruta)
      .on("error", () => res.destroy())
      .pipe(res);
  });
}
