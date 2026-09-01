import { createFileRoute } from "@tanstack/react-router";
import { buildMcpServerCard } from "@/lib/agent-resource-discovery";

export function mcpServerCardHandler(request: Request): Response {
  const origin = new URL(request.url).origin;
  return new Response(JSON.stringify(buildMcpServerCard(origin)), {
    headers: {
      "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
      "Access-Control-Allow-Methods": "GET",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "ETag",
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "application/mcp-server-card+json",
    },
  });
}

export const Route = createFileRoute("/.well-known/mcp/server-card.json")({
  server: {
    handlers: {
      GET: ({ request }) => mcpServerCardHandler(request),
    },
  },
});
