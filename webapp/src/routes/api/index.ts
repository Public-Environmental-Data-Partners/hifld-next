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
            "Read-only JSON metadata and download links for geospatial datasets, plus bounded same-origin query resources for the first-party workspace. This is not OGC API-Features or STAC: there are no /items, /features, or numeric dataset IDs in URLs. Use collection and dataset slugs; follow links in each JSON response.",
          links: {
            self: `${origin}/api`,
            openapi: `${origin}/api/openapi`,
            llms_txt: `${origin}/llms.txt`,
            agent_skills: `${origin}/.well-known/agent-skills/index.json`,
            api_catalog: `${origin}/.well-known/api-catalog`,
            mcp_server_card: `${origin}/.well-known/mcp/server-card.json`,
            ai_catalog: `${origin}/.well-known/ai-catalog.json`,
            mcp: `${origin}/mcp`,
            health: `${origin}/api/health`,
            collections: `${origin}/api/collections`,
            example_collection_datasets: `${origin}/api/collections/hifld?search=wastewater&limit=25&omit=description`,
            create_query: `${origin}/api/queries`,
            query_page: `${origin}/api/queries/{query_id}/pages`,
            query_tile: `${origin}/api/queries/{query_id}/tiles/{z}/{x}/{y}.mvt`,
          },
          hints: {
            search_params_on_collection_list_only:
              "Use GET /api/collections/{slug} with query params: search, tag_filters, limit, offset, omit (not q= on other paths).",
            discovery:
              "Read /llms.txt and GET /api/openapi before guessing URLs. Scanner clients can read the JSON MCP Server Card and ARD at their well-known paths, then use same-origin /mcp.",
            bulk_analysis:
              "For statewide filters, download GeoParquet/Shapefile from file metadata `links` or source URLs and use DuckDB or GeoPandas locally.",
            query_resources:
              "POST /api/queries starts a bounded query. POST /api/queries/{query_id}/pages requires X-HIFLD-Query-Token; its query_id path is bound to that token. offset is non-negative and page_size is 1..1000. Stable problem responses never expose SQL, credentials, physical paths, or tokens. Load MVT directly from the returned public dataset-mcp URL; the webapp does not proxy tiles.",
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
