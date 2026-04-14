import { createFileRoute } from "@tanstack/react-router";
import { requestOrigin } from "@/lib/api-links";

export const Route = createFileRoute("/api/")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const origin = requestOrigin(request);
        const body = {
          title: "HIFLD Next public API",
          description:
            "JSON metadata and download links for geospatial datasets. This is not OGC API-Features or STAC: there are no /items, /features, or numeric dataset IDs in URLs. Use collection and dataset slugs; follow links in each JSON response.",
          links: {
            self: `${origin}/api`,
            openapi: `${origin}/api/openapi`,
            llms_txt: `${origin}/llms.txt`,
            collections: `${origin}/api/collections`,
            example_collection_datasets: `${origin}/api/collections/hifld?search=wastewater&limit=25&omit=description`,
          },
          hints: {
            search_params_on_collection_list_only:
              "Use GET /api/collections/{slug} with query params: search, tag_filters, limit, offset, omit (not q= on other paths).",
            discovery: "Read /llms.txt and GET /api/openapi before guessing URLs.",
            bulk_analysis:
              "For statewide filters, download GeoParquet/Shapefile from file metadata `links` or source URLs and use DuckDB or GeoPandas locally.",
          },
        };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=300",
          },
        });
      },
    },
  },
});
