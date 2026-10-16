// Simulador de nodos: uno (credenciales sueltas) o una flota (identidades de la fábrica), con escenarios.
//
//   pnpm simulator                                        el nodo de `pnpm db:seed`, una lectura por minuto
//   pnpm simulator --intervalo 5 --escenario acidificacion
//   pnpm factory lote --cantidad 100 --version-hw sim --dev          # crea 100 nodos ya reclamados + identidades.json
//   pnpm simulator --identidades tools/factory/lotes/<lote>/identidades.json --nodos 100 --intervalo 10
//
// Un escenario es un archivo JSON (ver tools/simulator/escenarios/ y src/escenarios.ts); `--escenario nombre` busca en
// esa carpeta, o se pasa una ruta. Con una flota, el escenario lo corren todos los nodos salvo `--escenario-nodos N`
// (solo los primeros N; el resto queda en agua estable).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { COMPORTAMIENTOS_OTA, type ComportamientoOta } from "./comandos.ts";
import { type Escenario, leerEscenario } from "./escenarios.ts";
import { buscarHistoria, HISTORIAS } from "./historias.ts";
import { iniciarNodo, type NodoSimulado } from "./nodo.ts";

const { values } = parseArgs({
  options: {
    "device-id": { type: "string" },
    password: { type: "string" },
    identidades: { type: "string" },
    nodos: { type: "string" },
    escenario: { type: "string" },
    historia: { type: "string" },
    historias: { type: "boolean" },
    semilla: { type: "string" },
    "escenario-nodos": { type: "string" },
    url: { type: "string", default: process.env.MQTT_URL ?? "mqtts://localhost:8883" },
    ca: { type: "string", default: process.env.MQTT_CA_FILE },
    intervalo: { type: "string", default: "60" },
    lecturas: { type: "string" },
    "conexiones-por-segundo": { type: "string", default: "25" },
    firmware: { type: "string" },
    ota: { type: "string" },
    "rollback-s": { type: "string" },
    "reinicio-s": { type: "string" },
    "sin-descarga": { type: "boolean" },
    "buffer-max": { type: "string" },
    "vaciado-por-segundo": { type: "string" },
    ayuda: { type: "boolean", short: "h" },
  },
});

if (values.ayuda) {
  console.log(`Uso: simulator [--device-id ID --password PW | --identidades archivo.json [--nodos N]]
                 [--url mqtts://host:8883] [--ca ca.crt] [--intervalo segundos=60] [--lecturas N]
                 [--escenario nombre|ruta.json] [--escenario-nodos N] [--conexiones-por-segundo 25]
                 [--historia nombre] [--semilla N] [--firmware 1.0.0]
                 [--ota exito|rechaza|rollback|ignora] [--reinicio-s 3] [--rollback-s 30] [--sin-descarga]
                 [--buffer-max N=24 h] [--vaciado-por-segundo 20]
       simulator --historias      (lista las historias de agua con su nivel esperado)`);
  process.exit(0);
}

if (values.historias) {
  for (const h of HISTORIAS) {
    console.log(
      `${h.nombre.padEnd(22)} ${h.lecturas} lecturas  →  ${h.esperado.transiciones.join(" → ")}`,
    );
    console.log(`${"".padEnd(22)} ${h.descripcion}`);
  }
  process.exit(0);
}

function cargarEscenario(ref: string): Escenario {
  const ruta = ref.endsWith(".json")
    ? ref
    : join(import.meta.dirname, "..", "escenarios", `${ref}.json`);
  return leerEscenario(JSON.parse(readFileSync(ruta, "utf8")));
}
const escenario = values.escenario ? cargarEscenario(values.escenario) : undefined;
const historia = values.historia ? buscarHistoria(values.historia) : undefined;
if (values.historia && !historia) {
  console.error(`No existe la historia "${values.historia}". Usa --historias para verlas.`);
  process.exit(1);
}
const escenarioNodos = values["escenario-nodos"]
  ? Number(values["escenario-nodos"])
  : Number.POSITIVE_INFINITY;

interface Credencial {
  deviceId: string;
  password: string;
}
let credenciales: Credencial[];
if (values.identidades) {
  const archivo = JSON.parse(readFileSync(values.identidades, "utf8")) as {
    nodos: { deviceId: string; mqttPassword: string }[];
  };
  const limite = values.nodos ? Number(values.nodos) : archivo.nodos.length;
  credenciales = archivo.nodos
    .slice(0, limite)
    .map((n) => ({ deviceId: n.deviceId, password: n.mqttPassword }));
} else {
  const deviceId = values["device-id"] ?? process.env.DEV_NODO_ID;
  const password = values.password ?? process.env.DEV_NODO_PASSWORD;
  if (!deviceId || !password) {
    console.error(
      "Faltan --device-id y --password (o DEV_NODO_ID y DEV_NODO_PASSWORD), o --identidades.",
    );
    process.exit(1);
  }
  credenciales = [{ deviceId, password }];
}

const comportamientoOta = (values.ota ?? "exito") as ComportamientoOta;
if (!COMPORTAMIENTOS_OTA.includes(comportamientoOta)) {
  console.error(`--ota debe ser: ${COMPORTAMIENTOS_OTA.join(", ")}`);
  process.exit(1);
}
const otaOpciones = {
  comportamiento: comportamientoOta,
  descargar: !values["sin-descarga"],
  ...(values["reinicio-s"] ? { reinicioS: Number(values["reinicio-s"]) } : {}),
  ...(values["rollback-s"] ? { rollbackS: Number(values["rollback-s"]) } : {}),
};

const varios = credenciales.length > 1;
const registrar = (deviceId: string) => (mensaje: string, extra?: Record<string, unknown>) => {
  // Con una flota solo se muestran los eventos que importan; una línea por lectura la volvería ilegible.
  if (varios && (mensaje === "lectura publicada" || mensaje === "conectado")) return;
  console.log(
    JSON.stringify({ hora: new Date().toISOString(), nodo: deviceId.slice(-8), mensaje, ...extra }),
  );
};

const nodos: NodoSimulado[] = [];
const fallidos: string[] = [];
const pausa = 1000 / Math.max(1, Number(values["conexiones-por-segundo"]));

// Las conexiones se escalonan para no hacer una avalancha de TLS contra el broker.
for (const [i, c] of credenciales.entries()) {
  try {
    nodos.push(
      await iniciarNodo({
        deviceId: c.deviceId,
        password: c.password,
        url: values.url as string,
        caFile: values.ca,
        intervaloS: Number(values.intervalo),
        ...(values.lecturas ? { maxLecturas: Number(values.lecturas) } : {}),
        ...(escenario && i < escenarioNodos ? { escenario } : {}),
        ...(historia ? { historia } : {}),
        ...(values.semilla ? { semilla: Number(values.semilla) } : {}),
        ...(values.firmware ? { firmware: values.firmware } : {}),
        ota: otaOpciones,
        ...(values["buffer-max"] ? { bufferMax: Number(values["buffer-max"]) } : {}),
        ...(values["vaciado-por-segundo"]
          ? { vaciadoPorSegundo: Number(values["vaciado-por-segundo"]) }
          : {}),
        log: registrar(c.deviceId),
      }),
    );
  } catch (error) {
    fallidos.push(c.deviceId);
    console.error(`${c.deviceId.slice(-8)}: no se pudo conectar: ${(error as Error).message}`);
  }
  if (varios) await new Promise((r) => setTimeout(r, pausa));
}
if (nodos.length === 0) process.exit(1);
if (varios)
  console.log(`Flota en marcha: ${nodos.length} nodos conectados, ${fallidos.length} con error.`);

let saliendo = false;
const salir = async () => {
  if (saliendo) return;
  saliendo = true;
  await Promise.all(nodos.map((n) => n.detener().catch(() => undefined)));
  console.log(
    JSON.stringify({
      final: true,
      nodos: nodos.length,
      lecturasPublicadas: nodos.reduce((s, n) => s + n.publicadas(), 0),
    }),
  );
  process.exit(fallidos.length > 0 ? 1 : 0);
};
process.on("SIGINT", () => void salir());
process.on("SIGTERM", () => void salir());
if (values.lecturas || historia) {
  await Promise.all(nodos.map((n) => n.terminado));
  await salir();
}

if (varios) {
  setInterval(() => {
    const publicadas = nodos.reduce((suma, n) => suma + n.publicadas(), 0);
    console.log(
      JSON.stringify({
        hora: new Date().toISOString(),
        nodos: nodos.length,
        lecturasPublicadas: publicadas,
      }),
    );
  }, 60_000).unref();
}
