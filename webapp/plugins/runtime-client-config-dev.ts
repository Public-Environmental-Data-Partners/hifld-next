import type { Plugin } from "vite";
import { type RuntimeClientConfigEnv, runtimeClientConfigScriptFromEnv } from "../src/lib/server-runtime-client-config";

interface RuntimeConfigRequest {
  method?: string | undefined;
  url?: string | undefined;
}

interface RuntimeConfigResponse {
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

type NextMiddleware = () => void;

function processEnvironment(): RuntimeClientConfigEnv {
  return {
    PUBLIC_DATASET_API_URL: process.env["PUBLIC_DATASET_API_URL"],
    PUBLIC_POSTHOG_KEY: process.env["PUBLIC_POSTHOG_KEY"],
    PUBLIC_POSTHOG_HOST: process.env["PUBLIC_POSTHOG_HOST"],
    WEBMCP_ENABLED: process.env["WEBMCP_ENABLED"],
    DATASET_MCP_QUERY_API_URL: process.env["DATASET_MCP_QUERY_API_URL"],
  };
}

export function serveRuntimeClientConfig(
  request: RuntimeConfigRequest,
  response: RuntimeConfigResponse,
  next: NextMiddleware,
  environment: RuntimeClientConfigEnv = processEnvironment(),
): void {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (pathname !== "/runtime-config.js" || (request.method !== "GET" && request.method !== "HEAD")) {
    next();
    return;
  }

  response.setHeader("Content-Type", "application/javascript; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(request.method === "HEAD" ? undefined : runtimeClientConfigScriptFromEnv(environment));
}

/**
 * Vite handles missing JavaScript asset URLs before TanStack Start routes.
 * Serve the runtime script directly during development; Nitro continues to
 * use the file route in production.
 */
export function runtimeClientConfigDevPlugin(): Plugin {
  return {
    name: "hifld-runtime-client-config-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        serveRuntimeClientConfig(request, response, next);
      });
    },
  };
}
