import { createHash } from "node:crypto";

/** SKILL.md body for `hifld-catalog` (digest must match bytes served at `url`). */
export const HIFLD_CATALOG_SKILL_MD = `# HIFLD Next catalog

Use this skill when you need to explore **collections**, **datasets**, and **files** from the preserved HIFLD Open catalog via the webapp JSON API.

## Before you call paths

1. \`GET /api\` — bootstrap JSON with \`links\` (OpenAPI, \`llms.txt\`, collections list hints).
2. \`GET /api/openapi\` — OpenAPI 3.1 for all supported routes.
3. Read \`/llms.txt\` for human-oriented URL patterns and conventions.

## Discovery

- \`GET /.well-known/api-catalog\` — RFC 9727 API catalog (\`application/linkset+json\`): anchor + \`service-desc\`, \`service-doc\`, \`status\`.
- \`GET /.well-known/agent-skills/index.json\` — Agent Skills discovery (this index).
- \`GET /.well-known/mcp/server-card.json\` — JSON MCP Server Card describing
  the Streamable HTTP endpoint. It advertises same-origin \`/mcp\` by default;
  server-only \`DATASET_MCP_PUBLIC_ENDPOINT\` may override that advertised URL.
- \`GET /.well-known/ai-catalog.json\` — JSON Agent Resource Discovery (ARD)
  catalog with CORS for scanners and machine clients.
- \`GET /mcp\` — same-origin Streamable HTTP proxy. It forwards MCP traffic to
  server-only \`DATASET_MCP_QUERY_API_URL\`; internal service origins are never
  advertised by discovery documents.

## Typical flow

1. \`GET /api/collections\` — list collections.
2. \`GET /api/collections/{slug}\` — search datasets in one collection with \`search\` or \`query\`, \`tag_filters\`, \`limit\`, \`offset\`, \`omit\`, and \`include_urls\`.
3. \`GET /api/collections/{collectionSlug}/datasets/{datasetSlug}\` — open dataset detail by collection and dataset slug.
4. \`GET /api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}\` — inspect file metadata, formats, sources, returned \`links\`, source URLs, and GeoParquet options.
5. \`GET /api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}/schema\` — inspect schema/data dictionary metadata. Omit \`version\` to use the latest schema-capable version.
6. For local analysis, download returned source URLs or GeoParquet and use DuckDB, GeoPandas, or similar tools.
7. Follow \`links\` and relation URLs from responses rather than inventing path shapes.

## Contextual WebMCP (supported browsers only)

The JSON API remains read-only. A supported browser may expose contextual WebMCP
tools that read catalog or query data and modify only the current browser
workspace; they do not write catalog data. Use the collection-first discovery
flow above before acting on dataset or file context.

Exactly 19 contextual tools are available when their route state permits it:

- Catalog: \`list_collections\`, \`get_collection\`, \`search_datasets\`, \`get_dataset\`, \`get_dataset_file\`, \`get_dataset_file_schema\`.
- Version comparison: \`compare_file_versions\`.
- Map workspace: \`get_map_state\`, \`add_dataset_layer\`, \`remove_map_layer\`, \`set_layer_visibility\`, \`set_layer_style\`, \`reorder_map_layers\`, \`set_map_camera\`, \`set_basemap\`, \`get_map_selection\`, \`clear_map_selection\`.
- Bounded query: \`run_dataset_query\`, \`set_result_page\`.

The current standard \`document.modelContext\` surface is preferred. Some
native Chrome preview/scanner builds expose \`navigator.modelContext\` instead;
the webapp supports that native fallback without a polyfill. Unsupported
browsers expose no WebMCP tools and continue to use the ordinary webapp
unchanged.

Scanner acceptance checks the JSON MCP Server Card, JSON ARD response, and
same-origin \`/mcp\` proxy before checking native tool registration. The ARD
response permits cross-origin JSON discovery with CORS; MCP tool calls remain
same-origin.

## Query resource workflow

- \`POST /api/queries\` starts a bounded query and returns an opaque, non-secret \`query_id\`.
- \`POST /api/queries/{query_id}/pages\` takes a non-negative \`offset\` and a bounded \`page_size\` (1–1,000). Send the signed token only in \`X-HIFLD-Query-Token\`; the path \`query_id\` must match that token.
- \`GET /api/queries/{query_id}/bounds\` lazily calculates WGS84 query-result bounds for map framing. It uses the same signed-token header and bound \`query_id\`.
- Query failures use stable problem codes, not SQL, credentials, storage paths, or token details. Public MVT is loaded directly from the returned dataset-mcp URL; there is no webapp tile proxy.

## Constraints

- The JSON API remains read-only; WebMCP only changes the current browser workspace.
- This API is not OGC API-Features or STAC: no \`/items\`, \`/features\`, \`/download\`, or \`/map\` JSON routes.

Unknown paths under \`/api\` return \`404\` with \`application/problem+json\` and links back to \`/api\` and OpenAPI.
`;

export function skillArtifactDigest(markdown: string): string {
  return `sha256:${createHash("sha256").update(markdown, "utf8").digest("hex")}`;
}

/** Agent Skills Discovery index (RFC v0.2.0 style). */
export function buildAgentSkillsIndex(origin: string) {
  const skillUrl = `${origin}/.well-known/agent-skills/hifld-catalog/SKILL.md`;
  return {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [
      {
        name: "hifld-catalog",
        type: "skill-md",
        description: "Browse HIFLD Next collections and datasets using the JSON API, OpenAPI, and discovery documents.",
        url: skillUrl,
        digest: skillArtifactDigest(HIFLD_CATALOG_SKILL_MD),
      },
    ],
  };
}
