import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: "../..",
  server: { port: 5173, proxy: { "/api": { target: "http://localhost:3000", changeOrigin: false } } },
  build: { sourcemap: false, target: "es2022", chunkSizeWarningLimit: 700 },
});
