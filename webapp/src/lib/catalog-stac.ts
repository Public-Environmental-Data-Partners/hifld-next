import { z } from "zod";

const CATALOG_INDEX_SUFFIX = "/_catalog/catalog.sqlite";

// Preserve published extensions as well as the core STAC fields.
export const stacDocumentSchema = z
  .object({
    type: z.enum(["Catalog", "Collection"]),
    id: z.string(),
    stac_version: z.string(),
    description: z.string(),
    links: z.array(z.record(z.string(), z.json())),
  })
  .catchall(z.json());

export function catalogStacUrl(sqliteUrl: string, href: string): string {
  const indexUrl = new URL(sqliteUrl);
  if (!indexUrl.pathname.endsWith(CATALOG_INDEX_SUFFIX)) {
    throw new Error(`Catalog SQLite URL must end with ${CATALOG_INDEX_SUFFIX}`);
  }
  const bucketPath = `${indexUrl.pathname.slice(0, -CATALOG_INDEX_SUFFIX.length)}/`;
  const bucketRoot = new URL(indexUrl);
  bucketRoot.pathname = bucketPath;
  bucketRoot.search = "";
  bucketRoot.hash = "";
  const resolved = new URL(href, bucketRoot);
  if (resolved.origin !== bucketRoot.origin || !resolved.pathname.startsWith(bucketRoot.pathname)) {
    throw new Error("STAC href is outside the trusted catalog bucket");
  }
  return resolved.href;
}

export async function fetchCatalogStac(
  sqliteUrl: string,
  href: string,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const canonicalUrl = catalogStacUrl(sqliteUrl, href);
  // Nitro can coalesce identical upstream fetches across concurrent requests.
  // A Response body is a one-shot stream, so isolate each proxy request while
  // retaining the canonical location supplied to callers.
  const requestUrl = new URL(canonicalUrl);
  requestUrl.searchParams.set("__catalog_request", crypto.randomUUID());
  const upstream = await fetcher(requestUrl.href, { cache: "no-store" });
  if (!upstream.ok) return new Response(null, { status: upstream.status });
  const headers = new Headers();
  headers.set("Content-Location", canonicalUrl);
  headers.set("Content-Type", "application/json");
  for (const name of ["content-length", "etag", "last-modified", "cache-control"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Materialize the small JSON document before crossing Nitro's response
  // boundary. Passing a ReadableStream through here leaves concurrent callers
  // sharing a body that only one of them may consume.
  const body = await upstream.arrayBuffer();
  return new Response(body, { status: upstream.status, headers });
}
