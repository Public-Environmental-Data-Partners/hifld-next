import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const html = await readFile(resolve(root, "dist/index.html"), "utf8");

if (/\b(?:import|from)\s*(?:\(\s*)?["']@hifld\//.test(html)) {
  throw new Error("The MCP UI build contains a bare @hifld package import.");
}
