/// <reference types="vitest/config" />

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      "@hifld/map-core": new URL(
        "../../packages/map-core/src/index.ts",
        import.meta.url,
      ).pathname,
    },
    dedupe: ["lucide-react", "react", "react-dom"],
  },
  build: { target: "es2022", assetsInlineLimit: 100_000_000 },
  test: { environment: "jsdom", setupFiles: "./tests/setup.ts" },
});
