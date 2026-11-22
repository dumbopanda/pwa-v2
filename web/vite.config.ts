import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { DEFAULT_APP_NAME, THEME } from "./src/config.ts";

export default defineConfig(({ mode }) => {
  const APP_NAME = loadEnv(mode, process.cwd(), "VITE_").VITE_APP_NAME || DEFAULT_APP_NAME;
  return {
  plugins: [
    react(),
    { name: "app-name", transformIndexHtml: (html: string) => html.replace("%APP_NAME%", APP_NAME) },
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: APP_NAME,
        short_name: APP_NAME,
        start_url: "/",
        display: "standalone",
        background_color: THEME,
        theme_color: THEME,
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
};
});
