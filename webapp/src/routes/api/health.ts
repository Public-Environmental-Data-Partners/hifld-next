import { createFileRoute } from "@tanstack/react-router";
import { catalogRuntimeHealth } from "@/lib/catalog-runtime";

/** Lightweight liveness for RFC 9727 `status` links (`service-doc` / machine discovery). */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const catalog = await catalogRuntimeHealth();
        return new Response(JSON.stringify({ status: catalog.ready ? "ok" : "degraded", catalog }), {
          status: catalog.ready ? 200 : 503,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
