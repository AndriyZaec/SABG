import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Mobile-first PWA. Dev server proxies API + WS to the backend (P0.4 mock or real).
export default defineConfig({
  plugins: [react()],
  // Solana web3/wallet-adapter expect a Node-ish global in the browser.
  define: { global: "globalThis" },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          solana: [
            "@solana/web3.js",
            "@solana/wallet-adapter-base",
            "@solana/wallet-adapter-react",
            "@solana/wallet-adapter-react-ui",
            "@solana/wallet-adapter-wallets",
            "@coral-xyz/anchor",
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    allowedHosts: [".ngrok-free.app"],
    proxy: {
      // TEMP for manual CS2 testing: EventAccessGate always calls plain /api/access/session,
      // which normally targets soccer's gateway (4000). Pointed at CS2's gateway (4100) instead
      // since /api/access is generic (gateway/server.ts) and served by both. Revert to 4000
      // before testing soccer again.
      "/api": { target: "http://localhost:4100", changeOrigin: true },
      "/ws": { target: "ws://localhost:4100", ws: true },
      // CS2 runs as its own gateway process on its own port (CS2_GATEWAY_PORT, apps/api/src/cs2/run.ts)
      // — separate from soccer's gateway above, sharing only Postgres.
      "/cs2-api": {
        target: "http://localhost:4100",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/cs2-api/, "/api"),
      },
      "/cs2-ws": {
        target: "ws://localhost:4100",
        ws: true,
        rewrite: (path) => path.replace(/^\/cs2-ws/, "/ws"),
      },
    },
  },
});
