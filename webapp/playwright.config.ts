import { defineConfig } from "@playwright/test";

const host = "127.0.0.1";
const port = 4173;
const baseURL = `http://${host}:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && node .output/server/index.mjs",
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: !process.env["CI"],
    env: {
      DATASET_API_URL: "http://127.0.0.1:8000",
      NITRO_HOST: host,
      NITRO_PORT: String(port),
      WEBMCP_ENABLED: "true",
    },
  },
});
