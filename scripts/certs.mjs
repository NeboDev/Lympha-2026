// `pnpm certs`: crea o renueva la CA propia (infra/certs/ca.crt + ca.key) y el certificado de Mosquitto.
//   CERT_SANS="IP:192.168.1.50" pnpm certs      agrega nombres al certificado del broker (p. ej. la IP de tu equipo
//                                               para un nodo de prueba en la red local) y avisa al broker si corre.
import { spawnSync } from "node:child_process";

const base = ["compose", "-f", "infra/compose/base.yml", "-f", "infra/compose/dev.yml"];
const correr = (args, opciones = {}) =>
  spawnSync("docker", [...base, ...args], { stdio: "inherit", ...opciones });

const r = correr(["run", "--rm", "certs"]);
if (r.status !== 0) process.exit(r.status ?? 1);

// Si el broker está corriendo, que relea el certificado (SIGHUP); si no está, no pasa nada.
const corriendo = spawnSync("docker", [...base, "ps", "--status", "running", "--services"], {
  encoding: "utf8",
});
if (corriendo.stdout?.split(/\s+/).includes("mosquitto")) {
  correr(["kill", "-s", "HUP", "mosquitto"]);
  console.log("certs: el broker releyó el certificado");
}
