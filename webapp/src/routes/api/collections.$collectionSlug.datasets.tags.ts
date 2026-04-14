import { createFileRoute } from "@tanstack/react-router";
import { getCollectionBySlug, getCollectionTagValues } from "@/lib/api-client";
import { collectionDatasetsTagsSelf, requestOrigin } from "@/lib/api-links";
import { jsonProblem } from "@/lib/api-problem";

export const Route = createFileRoute(
  "/api/collections/$collectionSlug/datasets/tags"
)({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const collection = await getCollectionBySlug({
          data: { slug: params.collectionSlug },
        });
        if (!collection) {
          return jsonProblem(404, "Collection not found");
        }
        const url = new URL(request.url);
        const tagKey = url.searchParams.get("tag_key") ?? undefined;
        const tags = await getCollectionTagValues({
          data: { collectionId: collection.id, tagKey },
        });
        const origin = requestOrigin(request);
        return Response.json({
          links: { self: collectionDatasetsTagsSelf(origin, params.collectionSlug, tagKey) },
          collection: { id: collection.id, slug: collection.slug, name: collection.name },
          tags,
        });
      },
    },
  },
});
