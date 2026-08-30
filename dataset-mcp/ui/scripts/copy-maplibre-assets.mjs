import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(root, "node_modules/maplibre-gl/dist");
const destinationRoot = resolve(root, "dist");

await mkdir(destinationRoot, { recursive: true });
for (const filename of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  const destination = resolve(destinationRoot, filename);
  await mkdir(dirname(destination), { recursive: true });
  await cp(resolve(sourceRoot, filename), destination);
}
