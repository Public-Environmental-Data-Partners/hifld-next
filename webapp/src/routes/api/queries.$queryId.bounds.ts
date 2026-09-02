import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env/server";
import { QueryIdSchema, QueryTokenSchema } from "@/lib/query-api";

const QUERY_TOKEN_HEADER = "X-HIFLD-Query-Token";

type QueryFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type QueryBoundsProxyOptions = {
  baseUrl?: string;
  fetcher?: QueryFetcher;
  params?: { queryId: string };
  queryToken?: string | undefined;
};

function invalidRequest(): Response {
  return Response.json(
    { code: "invalid_request", message: "A query ID and query token are required." },
    { status: 400 },
  );
}

function upstreamUnavailable(): Response {
  return Response.json({ code: "upstream_unavailable", message: "The query service is unavailable." }, { status: 503 });
}

function responseFromUpstream(upstream: Response): Promise<Response> {
  const contentType = upstream.headers.get("Content-Type") ?? "application/json";
  return upstream.arrayBuffer().then(
    (body) =>
      new Response(body, {
        status: upstream.status,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "private, no-store",
          Vary: QUERY_TOKEN_HEADER,
        },
      }),
  );
}

export async function queryBoundsHandler(request: Request, options: QueryBoundsProxyOptions = {}): Promise<Response> {
  const queryId = options.params?.queryId;
  const queryToken = options.queryToken ?? request.headers.get(QUERY_TOKEN_HEADER) ?? undefined;
  if (
    queryId === undefined ||
    !QueryIdSchema.safeParse(queryId).success ||
    queryToken === undefined ||
    !QueryTokenSchema.safeParse(queryToken).success
  ) {
    return invalidRequest();
  }

  const baseUrl = options.baseUrl ?? env.DATASET_MCP_QUERY_API_URL;
  if (baseUrl === undefined) return upstreamUnavailable();
  const fetcher = options.fetcher ?? fetch;
  try {
    const upstream = await fetcher(`${baseUrl.replace(/\/$/, "")}/api/queries/${encodeURIComponent(queryId)}/bounds`, {
      method: "GET",
      headers: {
        [QUERY_TOKEN_HEADER]: queryToken,
        "X-Request-ID": crypto.randomUUID(),
      },
      signal: request.signal,
    });
    return responseFromUpstream(upstream);
  } catch (error) {
    if ((error instanceof Error || error instanceof DOMException) && error.name === "AbortError") throw error;
    return upstreamUnavailable();
  }
}

export const Route = createFileRoute("/api/queries/$queryId/bounds")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        queryBoundsHandler(request, {
          params,
          queryToken: request.headers.get(QUERY_TOKEN_HEADER) ?? undefined,
        }),
    },
  },
});
