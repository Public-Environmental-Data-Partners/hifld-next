import { createFileRoute } from "@tanstack/react-router";
import { buildAgentSkillsIndex } from "@/lib/agent-skills";

export const Route = createFileRoute("/.well-known/agent-skills/index.json")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const origin = new URL(request.url).origin;
        const body = buildAgentSkillsIndex(origin);
        return new Response(JSON.stringify(body, null, 2), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
