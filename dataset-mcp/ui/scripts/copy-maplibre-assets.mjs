import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

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
