import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env/server";

type McpFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type McpProxyOptions = {
  baseUrl?: string | undefined;
  fetcher?: McpFetcher | undefined;
};

const REQUEST_HEADER_NAMES = [
  "Accept",
  "Content-Type",
  "Last-Event-ID",
  "MCP-Protocol-Version",
  "MCP-Session-Id",
  "Origin",
] as const;

const RESPONSE_HEADER_NAMES = [
  "Cache-Control",
  "Content-Type",
  "MCP-Session-Id",
  "Retry-After",
  "WWW-Authenticate",
] as const;

const SUPPORTED_METHODS = new Set(["GET", "POST", "DELETE"]);
const ALLOW_HEADER = "GET, POST, DELETE, OPTIONS";

function forwardedRequestHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of REQUEST_HEADER_NAMES) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

function publicResponseHeaders(upstream: Headers): Headers {
  const headers = new Headers();
  for (const name of RESPONSE_HEADER_NAMES) {
    const value = upstream.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

function unavailable(): Response {
  return Response.json({ code: "mcp_unavailable", message: "The MCP service is unavailable." }, { status: 503 });
}

function methodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { Allow: ALLOW_HEADER } });
}

function forbiddenOrigin(): Response {
  return Response.json({ code: "origin_forbidden", message: "The request origin is not allowed." }, { status: 403 });
}

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (origin === null) return true;
  try {
    const parsed = new URL(origin);
    if (
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      return false;
    }
    return parsed.origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function configuredBaseUrl(value: string | undefined): string | null {
  const baseUrl = value?.trim();
  return baseUrl ? baseUrl.replace(/\/+$/, "") : null;
}

function upstreamMcpUrl(baseUrl: string, request: Request): string {
  return `${baseUrl}/mcp${new URL(request.url).search}`;
}

function isAbortError(error: Error | DOMException): boolean {
  return error.name === "AbortError";
}

function requestInit(request: Request): RequestInit {
  const baseInit: RequestInit = {
    method: request.method,
    headers: forwardedRequestHeaders(request),
    signal: request.signal,
  };
  if (request.body === null) return baseInit;
  const streamingInit: RequestInit & { duplex: "half" } = {
    ...baseInit,
    body: request.body,
    duplex: "half",
  };
  return streamingInit;
}

/** Proxy the same-origin Streamable HTTP endpoint without exposing upstream topology. */
export async function mcpProxyHandler(request: Request, options: McpProxyOptions = {}): Promise<Response> {
  if (!isSameOriginRequest(request)) return forbiddenOrigin();
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { Allow: ALLOW_HEADER } });
  }
  if (!SUPPORTED_METHODS.has(request.method)) return methodNotAllowed();

  const baseUrl = configuredBaseUrl(options.baseUrl ?? env.DATASET_MCP_QUERY_API_URL);
  if (baseUrl === null) return unavailable();

  const fetcher = options.fetcher ?? fetch;
  let upstream: Response;
  try {
    upstream = await fetcher(upstreamMcpUrl(baseUrl, request), requestInit(request));
  } catch (error) {
    if ((error instanceof Error || error instanceof DOMException) && isAbortError(error)) {
      throw error;
    }
    return unavailable();
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: publicResponseHeaders(upstream.headers),
  });
}

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      GET: ({ request }) => mcpProxyHandler(request),
      POST: ({ request }) => mcpProxyHandler(request),
      DELETE: ({ request }) => mcpProxyHandler(request),
      OPTIONS: ({ request }) => mcpProxyHandler(request),
    },
  },
});
