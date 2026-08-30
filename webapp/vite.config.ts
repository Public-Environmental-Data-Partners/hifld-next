import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import viteTsConfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

const config = defineConfig(({ mode }) => ({
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
  },
}));

export default config;
