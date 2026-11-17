import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// `localhost` (no 127.0.0.1): es el único host local que Firebase autoriza por defecto para el acceso con
// Google. El puerto 5173 es el origen que el servidor permite por defecto en CORS_ORIGINS.
export default defineConfig({
  plugins: [react()],
  // `fs.allow: [".."]`: los estilos importan design/tokens.css, que vive en la carpeta de arriba (fuente única de tokens).
  server: { host: "localhost", port: 5173, strictPort: true, fs: { allow: [".."] } },
  preview: { host: "localhost", port: 4173, strictPort: true },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
