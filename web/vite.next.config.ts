import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";

// The redesigned app (web/next). It shares the contract store and the testnet reader with the first app in web/src, and builds into
// dist/next, so one deploy of dist serves both: the first app at the root, this one at next/. Built after the first app, whose build
// empties dist.
export default defineConfig({
  root: resolve(import.meta.dirname, "next"),
  plugins: [react()],
  base: "./",
  publicDir: resolve(import.meta.dirname, "public"),
  resolve: { alias: { "@lib": resolve(import.meta.dirname, "../lib/src") } },
  server: { port: 5192, fs: { allow: [resolve(import.meta.dirname, "..")] } },
  build: { target: "es2022", outDir: resolve(import.meta.dirname, "dist/next"), emptyOutDir: true, chunkSizeWarningLimit: 1200 },
});
