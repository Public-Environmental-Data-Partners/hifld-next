import { createFileRoute } from "@tanstack/react-router";
import { buildAgentResourceDiscovery } from "@/lib/agent-resource-discovery";

export function agentResourceDiscoveryHandler(request: Request): Response {
  const origin = new URL(request.url).origin;
  return new Response(JSON.stringify(buildAgentResourceDiscovery(origin)), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export const Route = createFileRoute("/.well-known/ai-catalog.json")({
  server: {
    handlers: {
      GET: ({ request }) => agentResourceDiscoveryHandler(request),
    },
  },
});
