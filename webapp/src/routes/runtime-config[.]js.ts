import { createFileRoute } from "@tanstack/react-router";
import { runtimeClientConfigFromEnv } from "@/lib/server-runtime-client-config";

export const Route = createFileRoute("/runtime-config.js")({
  server: {
    handlers: {
      GET: () => {
        const config = runtimeClientConfigFromEnv({
          PUBLIC_DATASET_API_URL: process.env["PUBLIC_DATASET_API_URL"],
          PUBLIC_POSTHOG_KEY: process.env["PUBLIC_POSTHOG_KEY"],
          PUBLIC_POSTHOG_HOST: process.env["PUBLIC_POSTHOG_HOST"],
        });
        return new Response(`window.__HIFLD_CLIENT_CONFIG__=${JSON.stringify(config)};`, {
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
