import { describe, expect, it, vi } from "vitest";
import { queryCreateHandler } from "../api/queries";
import { queryPageHandler } from "../api/queries.$queryId.pages";

const body = {
  sources: [{ alias: "roads", collection_id: 1, dataset_id: 2, file_id: 3, file_source_id: 4 }],
  sql: "SELECT id FROM roads",
  limit: 10,
};

describe("same-origin query proxy routes", () => {
  it("forwards create requests with only content type and a generated request ID", async () => {
    const upstream = new Response(JSON.stringify({ query_id: "q", query_token: "t" }), {
      status: 201,
      headers: { "Content-Type": "application/json", "X-Internal": "hidden" },
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(upstream);

    const response = await queryCreateHandler(
      new Request("https://web.test/api/queries", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "session=secret", Authorization: "secret" },
        body: JSON.stringify(body),
      }),
      { fetcher, baseUrl: "http://dataset-mcp.internal:8000" },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ query_id: "q", query_token: "t" });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("http://dataset-mcp.internal:8000/api/queries");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.headers).toEqual(expect.objectContaining({ "Content-Type": "application/json" }));
    expect(init?.headers).not.toHaveProperty("Cookie");
    expect(init?.headers).not.toHaveProperty("Authorization");
    expect(init?.headers).toHaveProperty("X-Request-ID");
    expect(JSON.stringify(response.headers)).not.toContain("dataset-mcp.internal");
  });

  it("forwards the page token header and preserves upstream errors", async () => {
    const errorBody = { code: "query_timeout", message: "The query timed out" };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(errorBody), {
        status: 504,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await queryPageHandler(
      new Request("https://web.test/api/queries/query_12345678901234567890/pages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "session=secret",
          "X-HIFLD-Query-Token": "private-token",
        },
        body: JSON.stringify({ offset: 10, page_size: 10 }),
      }),
      {
        params: { queryId: "query_12345678901234567890" },
        fetcher,
        baseUrl: "http://dataset-mcp.internal:8000",
      },
    );

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual(errorBody);
    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(init?.headers).toEqual({
      "Content-Type": "application/json",
      "X-HIFLD-Query-Token": "private-token",
      "X-Request-ID": expect.any(String),
    });
  });

  it("returns a sanitized 503 for an upstream network failure", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(
      new Error("connect ECONNREFUSED dataset-mcp.internal:8000"),
    );

    const response = await queryCreateHandler(
      new Request("https://web.test/api/queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { fetcher, baseUrl: "http://dataset-mcp.internal:8000" },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "upstream_unavailable",
      message: "The query service is unavailable.",
    });
  });

  it("preserves cancellation instead of converting AbortError to a 503", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(abortError);

    await expect(
      queryCreateHandler(
        new Request("https://web.test/api/queries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        { fetcher, baseUrl: "http://dataset-mcp.internal:8000" },
      ),
    ).rejects.toBe(abortError);
  });
});
