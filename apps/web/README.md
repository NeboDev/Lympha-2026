# apps/web

PWA de Lympha (H4): React 19 + Vite + TanStack Query + React Router, instalable (`vite-plugin-pwa`). Habla con la API por
`@lympha/contracts`.

- `pnpm web` (desde la raíz): servidor de desarrollo en <http://127.0.0.1:5173>. Necesita la API (`pnpm dev`), que por defecto
  permite ese origen por CORS (`CORS_ORIGINS`).
- `pnpm web:build`: build de producción en `apps/web/dist` (con el service worker). Necesita `VITE_API_URL`,
  `VITE_FIREBASE_PROJECT_ID` y `VITE_FIREBASE_API_KEY`; sin ellas la app dice qué falta en vez de arrancar a medias.
- `pnpm test:e2e`: Playwright contra el stack real de `pnpm dev` (ver `playwright.config.ts`). `E2E_CHANNEL=msedge` usa el
  Edge instalado; si no, `pnpm --filter @lympha/web exec playwright install chromium`.
- Acceso: en desarrollo usa el emulador de Firebase Auth de `pnpm dev` (cualquier correo y contraseña de 6+ caracteres crea
  la cuenta; `pnpm dev:token` usa `lympha-dev-1`). Contra el proyecto real, ver `.env.example`.
- `VITE_API_URL` (ver `.env.example`) cambia la URL de la API; en desarrollo, por defecto `http://127.0.0.1:3000`.
- Todo lo que empieza con `VITE_` llega al navegador: nunca pongas secretos.
- Los iconos de `public/` los genera `node apps/web/scripts/generar-iconos.mjs`; solo hace falta si cambia el diseño.
- El service worker guarda únicamente el cascarón de la app: ninguna respuesta de la API se queda en el dispositivo.
