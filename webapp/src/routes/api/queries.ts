import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env/server";
import { QueryRequestSchema } from "@/lib/query-api";

type QueryFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type QueryProxyOptions = {
  baseUrl?: string;
  fetcher?: QueryFetcher;
};

function requestId(): string {
  return crypto.randomUUID();
}

function invalidRequest(message: string): Response {
  return Response.json({ code: "invalid_request", message }, { status: 400 });
}

function responseFromUpstream(upstream: Response): Promise<Response> {
  const contentType = upstream.headers.get("Content-Type") ?? "application/json";
  return upstream.arrayBuffer().then(
    (body) =>
      new Response(body, {
        status: upstream.status,
        headers: { "Content-Type": contentType },
      }),
  );
}

function upstreamUnavailable(): Response {
  return Response.json({ code: "upstream_unavailable", message: "The query service is unavailable." }, { status: 503 });
}

function isAbortError(error: Error | DOMException): boolean {
  return error.name === "AbortError";
}

export async function queryCreateHandler(request: Request, options: QueryProxyOptions = {}): Promise<Response> {
  let payload: ReturnType<typeof QueryRequestSchema.parse>;
  try {
    payload = QueryRequestSchema.parse(await request.json());
  } catch {
    return invalidRequest("The query request is invalid.");
  }

  const baseUrl = options.baseUrl ?? env.DATASET_MCP_QUERY_API_URL;
  if (baseUrl === undefined) {
    return upstreamUnavailable();
  }
  const fetcher = options.fetcher ?? fetch;
  let upstream: Response;
  try {
    upstream = await fetcher(`${baseUrl.replace(/\/$/, "")}/api/queries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": requestId(),
      },
      body: JSON.stringify(payload),
      signal: request.signal,
    });
  } catch (error) {
    if ((error instanceof Error || error instanceof DOMException) && isAbortError(error)) {
      throw error;
    }
    return upstreamUnavailable();
  }
  return responseFromUpstream(upstream);
}

export const Route = createFileRoute("/api/queries")({
  server: {
    handlers: {
      POST: ({ request }) => queryCreateHandler(request),
    },
  },
});
