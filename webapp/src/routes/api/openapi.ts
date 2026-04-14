import { createFileRoute } from "@tanstack/react-router";
import { buildOpenApiDocument } from "@/lib/openapi/spec";

/** OpenAPI document for public webapp JSON routes (stable path; avoids TanStack `openapi.json` → `/openapi/json` split). */
export const Route = createFileRoute("/api/openapi")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify(buildOpenApiDocument()), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=300",
          },
        }),
    },
  },
});
