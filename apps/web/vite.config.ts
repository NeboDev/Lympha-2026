import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Puerto 5173: es el origen que CORS_ORIGINS permite por defecto en desarrollo (infra/compose/dev.yml).
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
});
