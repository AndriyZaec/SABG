import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Mobile-first PWA. Dev server proxies API + WS to the backend (P0.4 mock or real).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
      "/ws": { target: "ws://localhost:4000", ws: true },
    },
  },
});
