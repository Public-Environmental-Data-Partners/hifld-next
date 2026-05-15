import { createFileRoute } from "@tanstack/react-router";

/** Lightweight liveness for RFC 9727 `status` links (`service-doc` / machine discovery). */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        }),
    },
  },
});
