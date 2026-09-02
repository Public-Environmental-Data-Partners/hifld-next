import { createFileRoute } from "@tanstack/react-router";
import { runtimeClientConfigScriptFromEnv } from "@/lib/server-runtime-client-config";

export const Route = createFileRoute("/runtime-config.js")({
  server: {
    handlers: {
      GET: () => {
        const script = runtimeClientConfigScriptFromEnv({
          PUBLIC_DATASET_API_URL: process.env["PUBLIC_DATASET_API_URL"],
          PUBLIC_POSTHOG_KEY: process.env["PUBLIC_POSTHOG_KEY"],
          PUBLIC_POSTHOG_HOST: process.env["PUBLIC_POSTHOG_HOST"],
          WEBMCP_ENABLED: process.env["WEBMCP_ENABLED"],
          DATASET_MCP_QUERY_API_URL: process.env["DATASET_MCP_QUERY_API_URL"],
        });
        return new Response(script, {
          status: 200,
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
