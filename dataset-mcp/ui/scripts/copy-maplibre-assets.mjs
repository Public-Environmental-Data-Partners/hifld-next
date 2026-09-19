import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const maplibrePackage = require.resolve("maplibre-gl/package.json");
const sourceRoot = resolve(dirname(maplibrePackage), "dist");
const destinationRoot = resolve(root, "dist");

await mkdir(destinationRoot, { recursive: true });
for (const filename of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  const destination = resolve(destinationRoot, filename);
  await mkdir(dirname(destination), { recursive: true });
  await cp(resolve(sourceRoot, filename), destination);
}

// Module workers fail in opaque-origin MCP iframes. A self-contained classic
// worker can be fetched cross-origin and run from a Blob in those sandboxes.
// MapLibre selects its classic-worker path for URLs ending in .cjs.
await build({
  configFile: false,
  logLevel: "warn",
  build: {
    target: "es2022",
    outDir: destinationRoot,
    emptyOutDir: false,
    lib: {
      entry: resolve(sourceRoot, "maplibre-gl-worker.mjs"),
      name: "MapLibreWorker",
      formats: ["iife"],
      fileName: () => "maplibre-gl-worker.cjs",
    },
  },
});
