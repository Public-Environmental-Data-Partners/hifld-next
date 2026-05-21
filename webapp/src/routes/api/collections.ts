import { createFileRoute } from "@tanstack/react-router";
import { type Collection, getCollections } from "@/lib/api-client";
import { collectionSelf, requestOrigin } from "@/lib/api-links";

export const Route = createFileRoute("/api/collections")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const collections = await getCollections();
        const origin = requestOrigin(request);
        const body = (collections as Collection[]).map((c) => ({
          ...c,
          links: { self: collectionSelf(origin, c.slug) },
        }));
        return Response.json(body);
      },
    },
  },
});
