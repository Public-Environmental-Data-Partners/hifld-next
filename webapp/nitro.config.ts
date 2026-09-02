import { defineNitroConfig } from "nitro/config";
import { discoveryLinkHeaderValue } from "./src/lib/agent-discovery";

export default defineNitroConfig({
  plugins: ["./plugins/posthog-discovery-analytics", "./plugins/webmcp-origin-trial"],
  runtimeConfig: {},
  routeRules: {
    "/": {
      headers: {
        link: discoveryLinkHeaderValue(),
      },
    },
    "/api/**": { cors: true },
    "/api/openapi": { cors: true },
    "/llms.txt": { cors: true },
    "/.well-known/agent-skills/**": { cors: true },
    "/.well-known/api-catalog": { cors: true },
  },
});
