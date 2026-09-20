import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env/server";
import { getCollectionBySlug, getCollectionTagValues } from "@/lib/api-client";
import { collectionDatasetsTagsSelf, requestOrigin } from "@/lib/api-links";
import { jsonProblem } from "@/lib/api-problem";
import { sqliteCatalogApi } from "@/lib/catalog-api";

export const Route = createFileRoute("/api/collections/$collectionSlug/datasets/tags")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const url = new URL(request.url);
        const tagKey = url.searchParams.get("tag_key") ?? undefined;
        const catalog = await sqliteCatalogApi();
        if (catalog) {
          const collection = await catalog.collection(params.collectionSlug);
          if (!collection) return jsonProblem(404, "Collection not found");
          const tags = await catalog.tags(params.collectionSlug, tagKey);
          const origin = requestOrigin(request, env.WEBAPP_PUBLIC_ORIGIN);
          return Response.json(
            {
              links: { self: collectionDatasetsTagsSelf(origin, params.collectionSlug, tagKey) },
              collection: {
                id: collection.collection_path,
                slug: collection.collection_slug,
                name: collection.name,
              },
              tags,
            },
            { headers: { "X-Catalog-Generation": catalog.generation } },
          );
        }
        const collection = await getCollectionBySlug({
          data: { slug: params.collectionSlug },
        });
        if (!collection) {
          return jsonProblem(404, "Collection not found");
        }
        const tags = await getCollectionTagValues({
          data: { collectionId: collection.id, tagKey },
        });
        const origin = requestOrigin(request, env.WEBAPP_PUBLIC_ORIGIN);
        return Response.json({
          links: { self: collectionDatasetsTagsSelf(origin, params.collectionSlug, tagKey) },
          collection: { id: collection.id, slug: collection.slug, name: collection.name },
          tags,
        });
      },
    },
  },
});
