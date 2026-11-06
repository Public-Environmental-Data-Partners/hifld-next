import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env/server";
import { buildRobotsTxt } from "@/lib/agent-discovery";
import { requestOrigin } from "@/lib/api-links";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const origin = requestOrigin(request, env.WEBAPP_PUBLIC_ORIGIN);
        return new Response(buildRobotsTxt(origin), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
