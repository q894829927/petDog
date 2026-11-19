import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/games/petdog/",
  plugins: [react()],
  server: {
    proxy: { "/pet-api": "http://127.0.0.1:3180" },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
