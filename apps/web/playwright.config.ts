import { defineConfig } from "@playwright/test";

/**
 * E2E de la PWA contra el stack REAL de desarrollo (`pnpm dev`: API, ingesta, worker, Postgres, Mosquitto y el
 * emulador de Firebase Auth) — sin simulaciones del servidor. Dos proyectos:
 *  - `app`: la app en modo desarrollo (`pnpm web`, :5173): registro, espacios, reclamo con el simulador, semáforo,
 *    alertas, invitaciones y Telegram.
 *  - `pwa`: el build de producción servido con `vite preview` (:4173): manifiesto, service worker y uso sin red.
 *
 *   pnpm dev                    # en otra terminal, y esperar a que la API responda
 *   pnpm test:e2e               # usa el Chromium de Playwright (pnpm exec playwright install chromium)
 *   E2E_CHANNEL=msedge pnpm test:e2e   # o el Edge / Chrome ya instalado (sin descargar nada)
 *
 * Cuando exista staging, el plan prevé correrlo ahí en cada despliegue; hoy solo contra el stack local.
 */
export default defineConfig({
  testDir: "e2e",
  // un solo trabajador: todas las pruebas comparten el stack y el emulador, y `flujo` va en orden
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    channel: process.env.E2E_CHANNEL || undefined,
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "app", testMatch: "flujo.spec.ts", use: { baseURL: "http://127.0.0.1:5173" } },
    { name: "pwa", testMatch: "pwa.spec.ts", use: { baseURL: "http://127.0.0.1:4173" } },
  ],
  webServer: [
    {
      command: "pnpm web",
      cwd: "../..",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      // Un build de producción no trae valores por omisión: se le dan los de prueba. Firebase nunca se contacta en
      // este proyecto (no hay inicio de sesión: un build de producción ignora el emulador a propósito).
      command: "pnpm web:build && pnpm --filter @lympha/web preview",
      cwd: "../..",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: true,
      timeout: 180_000,
      env: {
        VITE_API_URL: "http://127.0.0.1:3000",
        VITE_FIREBASE_PROJECT_ID: "lympha-e2e",
        VITE_FIREBASE_API_KEY: "llave-de-prueba-sin-uso",
      },
    },
  ],
});
