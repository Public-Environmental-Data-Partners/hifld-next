import { describe, expect, it, vi } from "vitest";
import {
  MAX_QUERY_BODY_BYTES,
  MAX_QUERY_SQL_BYTES,
  QueryApiError,
  QueryPageSchema,
  QueryRequestSchema,
  QueryResultSchema,
  createQuery,
  getQueryPage,
} from "@/lib/query-api";

const source = {
  alias: "roads",
  collection_id: 1,
  dataset_id: 2,
  file_id: 3,
  file_source_id: 4,
};

const page = {
  columns: [{ name: "id", type: "INTEGER", nullable: false }],
  rows: [{ id: 1 }],
  offset: 0,
  limit: 10,
  returned_count: 1,
  has_more: false,
  warnings: [],
  elapsed_ms: 1,
  bytes_read: 2,
  files_read: 1,
  response_truncated: false,
  deterministic_order: true,
  query_id: "query_12345678901234567890",
  query_token: "private-token",
};

describe("query-api", () => {
  it("rejects SQL larger than the bounded UTF-8 byte limit", () => {
    expect(MAX_QUERY_SQL_BYTES).toBe(8192);
    expect(MAX_QUERY_BODY_BYTES).toBeGreaterThan(MAX_QUERY_SQL_BYTES);
    expect(
      QueryRequestSchema.safeParse({ sources: [source], sql: "x".repeat(MAX_QUERY_SQL_BYTES + 1), limit: 10 }).success,
    ).toBe(false);
    expect(
      QueryRequestSchema.safeParse({ sources: [source], sql: "é".repeat(Math.floor(MAX_QUERY_SQL_BYTES / 2) + 1), limit: 10 })
        .success,
    ).toBe(false);
  });
  it("posts a typed query to the same-origin create route", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(page), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await createQuery(
      { sources: [source], sql: "SELECT id FROM roads", limit: 10 },
      { fetcher },
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/api/queries",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ sources: [source], sql: "SELECT id FROM roads", limit: 10 }),
      }),
    );
    expect(result.query_id).toBe(page.query_id);
    expect(result.rows[0]?.id).toBe(1);
  });

  it("parses a successful spatial result without exposing resolved source paths", () => {
    const result = QueryResultSchema.parse({
      ...page,
      map_configuration: {
        tile_url: "https://mcp.example.test/api/queries/query_12345678901234567890/tiles/{z}/{x}/{y}.mvt",
        worker_url: "https://mcp.example.test/assets/maplibre-gl-worker.mjs",
        source_layer: "hifld",
        geometry_column: "geometry",
        result_crs: "EPSG:4326",
        initial_bounds: [-80, 35, -79, 36],
      },
    });

    expect(result.map_configuration?.source_layer).toBe("hifld");
    expect(QueryResultSchema.safeParse({ ...page, resolved_sources: [] }).success).toBe(false);
  });

  it("sends the private token only as a page request header", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ...page, offset: 10 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const signal = new AbortController().signal;

    await getQueryPage(
      page.query_id,
      { offset: 10, page_size: 10 },
      { queryToken: page.query_token, signal, fetcher },
    );

    expect(fetcher).toHaveBeenCalledWith(
      `/api/queries/${page.query_id}/pages`,
      expect.objectContaining({
        signal,
        headers: {
          "Content-Type": "application/json",
          "X-HIFLD-Query-Token": page.query_token,
        },
      }),
    );
  });

  it("rejects binary and raw geometry cells", () => {
    expect(
      QueryPageSchema.safeParse({
        ...page,
        columns: [{ name: "geometry", type: "GEOMETRY", nullable: true }],
        rows: [{ geometry: { $type: "geometry", byte_length: 12 } }],
      }).success,
    ).toBe(true);
    expect(
      QueryPageSchema.safeParse({ ...page, rows: [{ id: { $type: "binary", byte_length: 4 } }] }).success,
    ).toBe(false);
    expect(
      QueryPageSchema.safeParse({ ...page, rows: [{ id: { type: "Point", coordinates: [1, 2] } }] }).success,
    ).toBe(false);
  });

  it("accepts nested DuckDB list and struct cells", () => {
    expect(
      QueryPageSchema.safeParse({
        ...page,
        columns: [
          { name: "items", type: "LIST", nullable: false },
          { name: "attributes", type: "STRUCT", nullable: false },
        ],
        rows: [{ items: [1, "two", null, { nested: true }], attributes: { values: [false, 3.5] } }],
      }).success,
    ).toBe(true);
  });

  it("rejects map URLs that are not HTTP(S)", () => {
    expect(
      QueryResultSchema.safeParse({
        ...page,
        map_configuration: {
          tile_url: "file:///tmp/{z}/{x}/{y}.mvt",
          worker_url: "https://example.test/assets/maplibre-gl-worker.mjs",
          source_layer: "hifld",
          geometry_column: "geometry",
          result_crs: "EPSG:4326",
        },
      }).success,
    ).toBe(false);
    expect(
      QueryResultSchema.safeParse({
        ...page,
        map_configuration: {
          tile_url: "https://mcp.example.test/api/queries/query_12345678901234567890/tiles/{z}/{x}/{y}.mvt",
          worker_url: "https://mcp.example.test/assets/other-worker.mjs",
          source_layer: "hifld",
          geometry_column: "geometry",
          result_crs: "EPSG:4326",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects map URLs with an unexpected path or query identity", () => {
    expect(
      QueryResultSchema.safeParse({
        ...page,
        map_configuration: {
          tile_url: "https://mcp.example.test/tiles/{z}/{x}/{y}.mvt",
          worker_url: "https://mcp.example.test/assets/maplibre-gl-worker.mjs",
          source_layer: "hifld",
          geometry_column: "geometry",
          result_crs: "EPSG:4326",
        },
      }).success,
    ).toBe(false);
    expect(
      QueryResultSchema.safeParse({
        ...page,
        map_configuration: {
          tile_url: "https://mcp.example.test/api/queries/other_query_12345678901234567890/tiles/{z}/{x}/{y}.mvt",
          worker_url: "https://mcp.example.test/assets/maplibre-gl-worker.mjs",
          source_layer: "hifld",
          geometry_column: "geometry",
          result_crs: "EPSG:4326",
        },
      }).success,
    ).toBe(false);
  });

  it("turns malformed upstream errors into a typed client error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "missing code" }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(createQuery({ sources: [source], sql: "SELECT id FROM roads", limit: 10 }, { fetcher })).rejects.toBeInstanceOf(
      QueryApiError,
    );
  });
});
