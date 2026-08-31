import { createFileRoute } from "@tanstack/react-router";
import { buildMcpServerCard } from "@/lib/agent-resource-discovery";

export function mcpServerCardHandler(request: Request): Response {
  const origin = new URL(request.url).origin;
  return new Response(JSON.stringify(buildMcpServerCard(origin)), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

export const Route = createFileRoute("/.well-known/mcp/server-card.json")({
  server: {
    handlers: {
      GET: ({ request }) => mcpServerCardHandler(request),
    },
  },
});
