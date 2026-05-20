import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(repoRoot, "shared"),
    },
  },
  build: {
    outDir: path.resolve(repoRoot, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    proxy: {
      "/api": "http://localhost:5000",
      "/ws": { target: "ws://localhost:5000", ws: true },
    },
  },
});
