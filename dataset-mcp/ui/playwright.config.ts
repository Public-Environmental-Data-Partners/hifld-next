import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-tests",
  timeout: 30_000,
  workers: 1,
  use: { headless: true, viewport: { width: 1000, height: 900 } },
});
