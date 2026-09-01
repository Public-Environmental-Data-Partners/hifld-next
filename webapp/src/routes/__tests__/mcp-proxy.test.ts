import { describe, expect, it, vi } from "vitest";
import { mcpProxyHandler } from "../mcp";

type McpFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

describe("same-origin MCP transport proxy", () => {
  it("rejects a hostile browser Origin without contacting the MCP service", async () => {
    const fetcher = vi.fn<McpFetcher>();
    const response = await mcpProxyHandler(
      new Request("https://web.example.test/mcp", {
        method: "POST",
        headers: { Origin: "https://evil.example.test" },
        body: '{"jsonrpc":"2.0"}',
      }),
      { baseUrl: "http://dataset-mcp.internal:8000", fetcher },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: "origin_forbidden",
      message: "The request origin is not allowed.",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("forwards only Streamable HTTP request headers to the fixed upstream MCP path", async () => {
    const fetcher = vi.fn<McpFetcher>().mockResolvedValue(new Response("ok"));
    const response = await mcpProxyHandler(
      new Request("https://web.example.test/mcp?cursor=next", {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          Authorization: "Bearer forbidden",
          Cookie: "session=forbidden",
          "Content-Type": "application/json",
          "Last-Event-ID": "event-9",
          "MCP-Protocol-Version": "2025-11-25",
          "MCP-Session-Id": "session-7",
          Origin: "https://web.example.test",
          "X-Forwarded-Host": "forbidden",
          "X-Unrelated": "forbidden",
        },
        body: '{"jsonrpc":"2.0"}',
      }),
      { baseUrl: "http://dataset-mcp.internal:8000", fetcher },
    );

    expect(response.status).toBe(200);
    const [input, init] = fetcher.mock.calls[0] ?? [];
    expect(input).toBe("http://dataset-mcp.internal:8000/mcp?cursor=next");
    expect(init?.method).toBe("POST");
    expect(init?.signal?.aborted).toBe(false);
    const forwardedHeaders = new Headers(init?.headers);
    expect([...forwardedHeaders].sort()).toEqual(
      [
        ["accept", "text/event-stream"],
        ["content-type", "application/json"],
        ["last-event-id", "event-9"],
        ["mcp-protocol-version", "2025-11-25"],
        ["mcp-session-id", "session-7"],
        ["origin", "https://web.example.test"],
      ].sort(),
    );
    expect(forwardedHeaders.has("Cookie")).toBe(false);
    expect(forwardedHeaders.has("Authorization")).toBe(false);
    expect(forwardedHeaders.has("Host")).toBe(false);
  });

  it("preserves upstream status and streaming body while suppressing internal response headers", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: message\ndata: streamed\n\n"));
        controller.close();
      },
    });
    const upstream = new Response(stream, {
      status: 202,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/event-stream",
        Location: "http://dataset-mcp.internal:8000/private",
        "MCP-Session-Id": "session-7",
        "Retry-After": "4",
        "Set-Cookie": "forbidden=true",
        "WWW-Authenticate": "Bearer",
        "X-Internal": "forbidden",
      },
    });
    const fetcher = vi.fn<McpFetcher>().mockResolvedValue(upstream);

    const response = await mcpProxyHandler(new Request("https://web.example.test/mcp", { method: "GET" }), {
      baseUrl: "http://dataset-mcp.internal:8000",
      fetcher,
    });

    expect(response.status).toBe(202);
    expect(response.body).toBe(upstream.body);
    expect(await response.text()).toBe("event: message\ndata: streamed\n\n");
    expect([...response.headers].sort()).toEqual(
      [...new Headers({
        "Cache-Control": "no-store",
        "Content-Type": "text/event-stream",
        "MCP-Session-Id": "session-7",
        "Retry-After": "4",
        "WWW-Authenticate": "Bearer",
      })].sort(),
    );
    expect(JSON.stringify([...response.headers])).not.toContain("dataset-mcp.internal");
  });

  it("responds locally to OPTIONS without contacting the internal service", async () => {
    const fetcher = vi.fn<McpFetcher>();
    const response = await mcpProxyHandler(new Request("https://web.example.test/mcp", { method: "OPTIONS" }), {
      baseUrl: "http://dataset-mcp.internal:8000",
      fetcher,
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("Allow")).toBe("GET, POST, DELETE, OPTIONS");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns a sanitized 503 without leaking the internal URL", async () => {
    const fetcher = vi.fn<McpFetcher>().mockRejectedValue(new Error("ECONNREFUSED dataset-mcp.internal"));
    const response = await mcpProxyHandler(new Request("https://web.example.test/mcp", { method: "GET" }), {
      baseUrl: "http://dataset-mcp.internal:8000",
      fetcher,
    });

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload).toEqual({
      code: "mcp_unavailable",
      message: "The MCP service is unavailable.",
    });
    expect(JSON.stringify(payload)).not.toContain("dataset-mcp.internal");
  });

  it("preserves AbortError instead of converting cancellation into a 503", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const fetcher = vi.fn<McpFetcher>().mockRejectedValue(abortError);

    await expect(
      mcpProxyHandler(new Request("https://web.example.test/mcp", { method: "DELETE" }), {
        baseUrl: "http://dataset-mcp.internal:8000",
        fetcher,
      }),
    ).rejects.toBe(abortError);
  });

  it("returns the same sanitized 503 when the internal service is unconfigured", async () => {
    const fetcher = vi.fn<McpFetcher>();
    const response = await mcpProxyHandler(new Request("https://web.example.test/mcp", { method: "GET" }), {
      baseUrl: " ",
      fetcher,
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "mcp_unavailable",
      message: "The MCP service is unavailable.",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
