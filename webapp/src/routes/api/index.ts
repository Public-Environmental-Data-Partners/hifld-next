import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env/server";
import { requestOrigin } from "@/lib/api-links";

export const Route = createFileRoute("/api/")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const origin = requestOrigin(request, env.WEBAPP_PUBLIC_ORIGIN);
        const body = {
          title: "HIFLD Next public API",
          description:
            "Read-only Portolan STAC Catalog and Collection metadata, paginated dataset search, and bounded same-origin query resources. OGC API Features is served separately at /features; there are no /items routes under /api dataset paths. Use collection and dataset slugs, not numeric IDs.",
          links: {
            self: `${origin}/api`,
            openapi: `${origin}/api/openapi`,
            llms_txt: `${origin}/llms.txt`,
            agent_skills: `${origin}/.well-known/agent-skills/index.json`,
            api_catalog: `${origin}/.well-known/api-catalog`,
            mcp_server_card: `${origin}/.well-known/mcp/server-card.json`,
            ai_catalog: `${origin}/.well-known/ai-catalog.json`,
            mcp: `${origin}/mcp`,
            features: `${origin}/features/collections`,
            health: `${origin}/api/health`,
            collections: `${origin}/api/collections`,
            example_collection_datasets: `${origin}/api/collections/hifld/datasets?search=wastewater&limit=25&omit=description`,
            create_query: `${origin}/api/queries`,
            query_page: `${origin}/api/queries/{query_id}/pages`,
            query_bounds: `${origin}/api/queries/{query_id}/bounds`,
            query_tile: `${origin}/api/queries/{query_id}/tiles/{z}/{x}/{y}.mvt`,
          },
          hints: {
            search_params_on_collection_list_only:
              "Use GET /api/collections/{slug}/datasets with query params: search, tag_filters, limit, offset, omit (not q= on other paths). GET /api/collections/{slug} returns the raw STAC Catalog.",
            discovery:
              "Read /llms.txt and GET /api/openapi before guessing URLs. Scanner clients can read the JSON MCP Server Card and ARD at their well-known paths, then use same-origin /mcp.",
            bulk_analysis:
              "For statewide filters, download GeoParquet/Shapefile from file metadata `links` or source URLs and use DuckDB or GeoPandas locally.",
            query_resources:
              "POST /api/queries starts a bounded query. Page and bounds resources require X-HIFLD-Query-Token; their query_id path is bound to that token. Bounds are computed lazily for map framing. Stable problem responses never expose SQL, credentials, physical paths, or tokens. Load MVT directly from the returned public dataset-mcp URL; the webapp does not proxy tiles.",
            catalog_writes:
              "The JSON catalog API remains read-only. Contextual browser WebMCP tools may modify only the current browser workspace.",
            mcp_transport:
              "The JSON MCP Server Card advertises same-origin /mcp by default. The webapp proxy forwards to server-only DATASET_MCP_QUERY_API_URL; DATASET_MCP_PUBLIC_ENDPOINT is an optional server-only public endpoint override and internal origins are not exposed.",
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
