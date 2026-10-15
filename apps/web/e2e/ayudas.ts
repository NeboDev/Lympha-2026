import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

/** Raíz del repositorio: los comandos del monorepo (`pnpm factory`, `pnpm simulator`) se corren desde ahí. */
export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ES_WINDOWS = process.platform === "win32";

/** Contraseña de las cuentas de prueba del emulador de Firebase (la misma de `pnpm dev:token`). */
export const CONTRASENA = "lympha-dev-1";

/** Un correo que no se repite entre corridas (el emulador conserva las cuentas mientras viva). */
export const correoUnico = (prefijo: string) =>
  `e2e-${prefijo}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@lympha.test`;

/** Crea una cuenta desde la pantalla de acceso y espera a ver el inicio. */
export async function crearCuenta(page: Page, nombre: string, correo: string) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/acceso/);
  await page.getByRole("button", { name: "Crear una cuenta" }).click();
  await page.getByLabel("Tu nombre").fill(nombre);
  await page.getByLabel("Correo").fill(correo);
  await page.getByLabel("Contraseña").fill(CONTRASENA);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Tus espacios" })).toBeVisible();
}

export interface NodoFabricado {
  deviceId: string;
  codigo: string;
  /** Archivo de identidades (lo lee el simulador; aquí nunca se lee ni se imprime su contenido secreto). */
  archivo: string;
}

/** Fabrica un nodo SIN reclamar con el CLI de fábrica (el mismo camino que usará la línea de producción). */
export function fabricarNodo(): NodoFabricado {
  const salida = execFileSync("pnpm", ["factory", "lote", "--cantidad", "1"], {
    cwd: RAIZ,
    encoding: "utf8",
    shell: ES_WINDOWS,
  });
  const dir = /Archivos en (.+)/.exec(salida)?.[1]?.trim();
  if (!dir) throw new Error("el CLI de fábrica no dijo dónde dejó el lote");
  const archivo = join(dir, "identidades.json");
  // solo se toman el id y el código de reclamo (lo que va en la etiqueta); la contraseña MQTT se queda en el archivo
  const { deviceId, codigoReclamo } = (
    JSON.parse(readFileSync(archivo, "utf8")) as {
      nodos: { deviceId: string; codigoReclamo: string }[];
    }
  ).nodos[0] as { deviceId: string; codigoReclamo: string };
  return { deviceId, codigo: codigoReclamo, archivo };
}

export interface Simulador {
  detener(): void;
}

/** Corre una historia de agua del simulador con el nodo fabricado, a una lectura por segundo. */
export function iniciarSimulador(nodo: NodoFabricado, historia: string): Simulador {
  const proceso: ChildProcess = spawn(
    "pnpm",
    [
      "simulator",
      "--identidades",
      nodo.archivo,
      "--nodos",
      "1",
      "--historia",
      historia,
      "--intervalo",
      "1",
    ],
    { cwd: RAIZ, stdio: "ignore", shell: ES_WINDOWS },
  );
  return {
    detener() {
      if (proceso.pid === undefined || proceso.killed) return;
      try {
        if (ES_WINDOWS)
          execFileSync("taskkill", ["/pid", String(proceso.pid), "/T", "/F"], { stdio: "ignore" });
        else proceso.kill("SIGTERM");
      } catch {
        // ya había terminado
      }
    },
  };
}

/**
 * Hace lo que haría el bot de Telegram al recibir «/start <token>»: deja el vínculo del usuario en la base de
 * desarrollo. No se puede pulsar «Iniciar» en un Telegram real desde una prueba automática; el flujo del bot lo
 * cubren las pruebas de integración del servidor.
 */
export function vincularTelegramComoElBot(correo: string, chatId: number) {
  if (!/^[\w.+-]+@lympha\.test$/.test(correo)) throw new Error("solo cuentas de prueba");
  execFileSync(
    "docker",
    [
      "exec",
      "lympha-postgres-1", // el contenedor del Compose de desarrollo (proyecto `lympha`)
      "psql",
      "-U",
      "postgres",
      "-d",
      "lympha",
      "-c",
      `INSERT INTO app.vinculos_telegram (usuario_id, chat_id) SELECT id, ${Math.trunc(chatId)} FROM app.usuarios WHERE email = '${correo}' ON CONFLICT DO NOTHING`,
    ],
    { cwd: RAIZ, stdio: "ignore" },
  );
}
