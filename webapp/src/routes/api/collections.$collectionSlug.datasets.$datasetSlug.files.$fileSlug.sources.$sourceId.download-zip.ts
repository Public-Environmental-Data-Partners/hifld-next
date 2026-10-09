import { createFileRoute } from "@tanstack/react-router";
import { catalogAssetUrl } from "@/lib/api-client";
import { jsonProblem } from "@/lib/api-problem";
import { type CatalogAsset, sqliteCatalogApi } from "@/lib/catalog-api";

export function catalogZipRedirect(assets: CatalogAsset[], sourceId: string): Response {
  const asset = assets.find((candidate) => `${candidate.version}/${candidate.asset_key}` === sourceId);
  if (asset?.media_type !== "application/zip") return jsonProblem(404, "ZIP source not found");
  const location = catalogAssetUrl(asset);
  if (!location) return jsonProblem(404, "ZIP source not found");
  const url = new URL(location);
  if (url.protocol !== "https:" && url.protocol !== "http:") return jsonProblem(502, "Invalid storage URL");
  return new Response(null, { status: 302, headers: { Location: location } });
}

export const Route = createFileRoute(
  "/api/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug/sources/$sourceId/download-zip",
)({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const catalog = await sqliteCatalogApi();
          const file = await catalog.file(params.collectionSlug, params.datasetSlug, params.fileSlug);
          return file ? catalogZipRedirect(file.assets, params.sourceId) : jsonProblem(404, "File not found");
        } catch {
          return jsonProblem(503, "Catalog downloads are unavailable");
        }
      },
    },
  },
});
