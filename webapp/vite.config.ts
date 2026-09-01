import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import viteTsConfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

const config = defineConfig(({ mode }) => ({
  // Keep local development reachable through the same IPv4 URL used by the
  // dataset API, browser tooling, and generated links. Vite's localhost
  // default can otherwise bind only to ::1 on macOS.
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
  },
  // Shared source packages declare React as a peer. Resolve that peer from
  // this application even when npm links the package outside this directory.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
    dedupe: ["lucide-react", "react", "react-dom"],
  },
  // Nitro's node_modules trace copies only part of this package (e.g. dist/index.mjs),
  // while Node's resolver still targets dist/index.cjs from "main" and breaks Docker runtime.
  ssr: {
    noExternal: ["@asteasolutions/zod-to-openapi", "react-resizable-panels"],
  },
  plugins: [
    devtools(),
    nitro(),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    // Route-module behavior tests use Vitest's normal React module graph.
    ...(mode === "test"
      ? []
      : [
          tanstackStart({
            router: {
              routeFileIgnorePattern: "(/__tests__/|\\.(test|spec)\\.(ts|tsx)$)",
            },
          }),
        ]),
    viteReact(),
  ],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "plugins/**/*.test.ts"],
  },
}));

export default config;
