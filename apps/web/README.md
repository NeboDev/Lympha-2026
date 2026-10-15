# apps/web

PWA de Lympha (H4): React 19 + Vite + TanStack Query + React Router. Habla con la API por `@lympha/contracts`.

- `pnpm web` (desde la raíz): servidor de desarrollo en <http://127.0.0.1:5173>. Necesita la API (`pnpm dev`), que por defecto
  permite ese origen por CORS (`CORS_ORIGINS`).
- `pnpm web:build`: build de producción en `apps/web/dist`.
- Acceso: en desarrollo usa el emulador de Firebase Auth de `pnpm dev` (cualquier correo y contraseña de 6+ caracteres crea
  la cuenta; `pnpm dev:token` usa `lympha-dev-1`). Contra el proyecto real, ver `.env.example`.
- `VITE_API_URL` (ver `.env.example`) cambia la URL de la API; por defecto `http://127.0.0.1:3000`.
- Todo lo que empieza con `VITE_` llega al navegador: nunca pongas secretos.
