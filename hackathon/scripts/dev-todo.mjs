// Arranca el servidor y la web de Atl juntos, cada uno con su `pnpm --ignore-workspace dev`.
// Ctrl+C detiene los dos. Lee server/.env y web/.env como siempre; no toca ningún secreto.
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("..", import.meta.url));
const esWindows = process.platform === "win32";

const procesos = [
  { nombre: "servidor", carpeta: "server", url: "http://localhost:3000" },
  { nombre: "web     ", carpeta: "web", url: "http://localhost:5173" },
];

const hijos = [];
let cerrando = false;

function detener() {
  if (cerrando) return;
  cerrando = true;
  for (const h of hijos) {
    if (h.exitCode !== null || !h.pid) continue;
    // En Windows `pnpm` deja procesos nietos: se mata el árbol completo.
    if (esWindows) spawnSync("taskkill", ["/PID", String(h.pid), "/T", "/F"], { stdio: "ignore" });
    else h.kill("SIGTERM");
  }
}

function prefijar(nombre, flujo, destino) {
  let resto = "";
  flujo.on("data", (trozo) => {
    resto += trozo.toString();
    const lineas = resto.split(/\r?\n/);
    resto = lineas.pop() ?? "";
    for (const l of lineas) if (l.trim() !== "") destino.write(`[${nombre}] ${l}\n`);
  });
}

for (const p of procesos) {
  const h = spawn("pnpm", ["--ignore-workspace", "dev"], {
    cwd: `${raiz}${p.carpeta}`,
    shell: esWindows,
    stdio: ["ignore", "pipe", "pipe"],
  });
  prefijar(p.nombre, h.stdout, process.stdout);
  prefijar(p.nombre, h.stderr, process.stderr);
  h.on("exit", (codigo) => {
    if (cerrando) return;
    process.stderr.write(`[${p.nombre}] terminó (código ${codigo}); deteniendo lo demás.\n`);
    detener();
    process.exitCode = codigo ?? 1;
  });
  hijos.push(h);
}

process.on("SIGINT", detener);
process.on("SIGTERM", detener);
process.on("exit", detener);

console.log(
  `Atl: servidor en ${procesos[0]?.url} y web en ${procesos[1]?.url}. Ctrl+C para detener.`,
);
