import { describe, expect, it } from "vitest";
import {
  ErrorPayloadSchema,
  GeometrySummarySchema,
  QueryPageSchema,
  QueryResultSchema,
  TruncatedValueSchema,
} from "../src/mcp/contracts";

describe("MCP contracts", () => {
  it("accepts a typed query page and preserves pagination metadata", () => {
    const page = QueryPageSchema.parse({
      columns: [{ name: "id", type: "BIGINT", nullable: false }],
      rows: [{ id: "1" }],
      offset: 0,
      limit: 100,
      has_more: true,
      next_offset: 100,
    });
    expect(page.next_offset).toBe(100);
  });
  it("validates query result boundaries", () => {
    expect(
      QueryResultSchema.safeParse({
        columns: [],
        rows: [],
        offset: 0,
        limit: 100,
        has_more: false,
      }).success,
    ).toBe(true);
    expect(QueryResultSchema.safeParse({ rows: "bad" }).success).toBe(false);
  });
  it("accepts DuckDB's dollar-prefixed tagged cell summaries", () => {
    expect(
      GeometrySummarySchema.parse({
        $type: "geometry",
        byte_length: 42,
      }).$type,
    ).toBe("geometry");
    expect(
      TruncatedValueSchema.parse({ $type: "truncated", byte_length: 99 }).$type,
    ).toBe("truncated");
    expect(
      QueryPageSchema.parse({
        columns: [
          { name: "shape", type: "GEOMETRY", nullable: true },
          { name: "blob", type: "BLOB", nullable: true },
        ],
        rows: [
          {
            shape: { $type: "geometry", byte_length: 42 },
            blob: { $type: "binary", byte_length: 128 },
          },
        ],
        offset: 0,
        limit: 1,
        has_more: false,
      }).rows[0]?.shape,
    ).toEqual({ $type: "geometry", byte_length: 42 });
  });
  it("accepts optional map configuration on query results", () => {
    const page = QueryResultSchema.parse({
      columns: [],
      rows: [],
      offset: 0,
      limit: 100,
      has_more: false,
      map_configuration: {
        geometry_type: "Point",
        tile_url: "/tiles/{z}/{x}/{y}.mvt",
      },
    });
    expect(page.map_configuration?.geometry_type).toBe("Point");
  });
  it("normalizes stable errors", () => {
    expect(
      ErrorPayloadSchema.parse({ code: "query_rejected", message: "Nope" })
        .code,
    ).toBe("query_rejected");
  });
});
