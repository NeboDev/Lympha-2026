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
- Los logos (`src/assets/`) y los iconos de la PWA (`public/`) salen de los JPG de `docs/marca/` con `pwsh apps/web/scripts/procesar-logos.ps1` (PowerShell 7 en Windows); solo hace falta si cambia la marca. Referencia de estilo: `docs/marca/DESIGN.md`.
- El service worker guarda únicamente el cascarón de la app: ninguna respuesta de la API se queda en el dispositivo.

## Licencias de terceros (iconos y fuente)
- **Iconos** (`src/componentes/Iconos.tsx`): trazados copiados de [Lucide](https://lucide.dev) (licencia ISC, uso comercial libre, sin atribución obligatoria más allá de conservar el aviso de la licencia: «Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT); all other copyright (c) for Lucide are held by Lucide Contributors»). Todo el set es de línea de 24×24 con trazo de 2 px, así que cualquier icono nuevo debe salir de la misma familia. El símbolo de error de `[role="alert"]` (`--ico-error` en `estilos.css`) es el mismo `circle-alert`. No se usan iconos de Flaticon: sus iconos gratuitos exigen cuenta para descargar y atribución visible en la app, y mezclarían estilos con este set.
- **Fuente** Inter (`public/fuentes/inter-latin.woff2`): SIL Open Font License 1.1, obtenida de `@fontsource-variable/inter` 5.2.8.
