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
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
      "/ws": { target: "ws://localhost:4000", ws: true },
    },
  },
});
