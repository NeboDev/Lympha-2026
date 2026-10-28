import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const COLOR = "#fdfcfc";

// Puerto 5173: es el origen que CORS_ORIGINS permite por defecto en desarrollo (infra/compose/dev.yml);
// 4173 es el de `vite preview` (el build con el service worker).
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      // «prompt»: una versión nueva no recarga la pantalla de golpe (podría haber un formulario a medias);
      // la persona decide cuándo actualizar (ver src/pwa/AvisosPWA.tsx).
      registerType: "prompt",
      includeAssets: ["favicon-64.png", "apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "Lympha",
        short_name: "Lympha",
        description: "Calidad del agua de tu cisterna, en un vistazo.",
        lang: "es-MX",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: COLOR,
        background_color: "#fdfcfc",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Solo el cascarón de la app (JS, CSS, HTML, iconos). NO hay `runtimeCaching`: ninguna respuesta de la API se
        // guarda en el dispositivo (son datos de la cuenta, RNF-01) y el SSE nunca pasa por el service worker.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
});
