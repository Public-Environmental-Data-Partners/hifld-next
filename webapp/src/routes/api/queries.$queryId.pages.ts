import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env/server";
import { QueryIdSchema, QueryPageRequestSchema, QueryTokenSchema } from "@/lib/query-api";

const QUERY_TOKEN_HEADER = "X-HIFLD-Query-Token";

type QueryFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type QueryPageProxyOptions = {
  baseUrl?: string;
  fetcher?: QueryFetcher;
  params?: { queryId: string };
  queryToken?: string | undefined;
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

export async function queryPageHandler(request: Request, options: QueryPageProxyOptions = {}): Promise<Response> {
  const queryId = options.params?.queryId;
  const queryToken = options.queryToken ?? request.headers.get(QUERY_TOKEN_HEADER) ?? undefined;
  if (
    queryId === undefined ||
    !QueryIdSchema.safeParse(queryId).success ||
    queryToken === undefined ||
    !QueryTokenSchema.safeParse(queryToken).success
  ) {
    return invalidRequest("A query ID and query token are required.");
  }

  let payload: ReturnType<typeof QueryPageRequestSchema.parse>;
  try {
    payload = QueryPageRequestSchema.parse(await request.json());
  } catch {
    return invalidRequest("The query page request is invalid.");
  }

  const baseUrl = options.baseUrl ?? env.DATASET_MCP_QUERY_API_URL;
  if (baseUrl === undefined) {
    return upstreamUnavailable();
  }
  const fetcher = options.fetcher ?? fetch;
  let upstream: Response;
  try {
    upstream = await fetcher(`${baseUrl.replace(/\/$/, "")}/api/queries/${encodeURIComponent(queryId)}/pages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [QUERY_TOKEN_HEADER]: queryToken,
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

export const Route = createFileRoute("/api/queries/$queryId/pages")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        queryPageHandler(request, {
          params,
          queryToken: request.headers.get(QUERY_TOKEN_HEADER) ?? undefined,
        }),
    },
  },
});
