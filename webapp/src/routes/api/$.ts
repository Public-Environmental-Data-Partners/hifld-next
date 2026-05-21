import { createFileRoute } from "@tanstack/react-router";
import { requestOrigin } from "@/lib/api-links";
import { jsonProblem } from "@/lib/api-problem";

function apiNotFound(request: Request) {
  const origin = requestOrigin(request);
  const path = new URL(request.url).pathname;

  let detail =
    "No handler for this path. This API is not OGC API-Features or STAC: there are no /items, /features, /download, or /map endpoints under dataset URLs.";
  if (path.includes("/items") || path.includes("/features")) {
    detail +=
      " Use GET /api/collections/{collectionSlug} with query params search, tag_filters, limit, offset, omit (not q= on invented paths). Then GET /api/collections/{collectionSlug}/datasets/{datasetSlug}, then .../files/{fileSlug} for file metadata and download URLs.";
  } else if (path.match(/\/api\/collections\/[^/]+\/\d+(?:\/|$)/)) {
    detail +=
      " Dataset URLs use slugs, not numeric IDs in the path after the collection (e.g. .../datasets/epa-frs-icis-wastewater-treatment-plants).";
  }

  const links = {
    api_index: `${origin}/api`,
    openapi: `${origin}/api/openapi`,
    llms_txt: `${origin}/llms.txt`,
    collections: `${origin}/api/collections`,
  };

  return jsonProblem(404, "Not Found", detail, { instance: path, links });
}

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: ({ request }) => apiNotFound(request),
    },
  },
});
