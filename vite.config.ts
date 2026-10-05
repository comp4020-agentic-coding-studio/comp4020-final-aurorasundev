import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The Express server (pnpm start / dev:server) owns /api and /readme/; in dev,
// Vite serves the client and proxies those through to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
      "/readme": "http://localhost:8080",
    },
  },
});
