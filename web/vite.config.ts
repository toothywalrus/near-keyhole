import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";

// base "./" so dist/ works from any path or a plain file server.
export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: { alias: { "@lib": resolve(__dirname, "../lib/src") } },
  server: { port: 5191, fs: { allow: [".."] } },
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
});
