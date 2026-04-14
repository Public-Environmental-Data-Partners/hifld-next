import { defineNitroConfig } from "nitro/config";

export default defineNitroConfig({
  runtimeConfig: {},
  routeRules: {
    "/api/**": { cors: true },
    "/api/openapi": { cors: true },
    "/llms.txt": { cors: true },
  },
});
