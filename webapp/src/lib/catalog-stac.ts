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
  const upstream = await fetcher(canonicalUrl, { cache: "no-store" });
  if (!upstream.ok) return new Response(null, { status: upstream.status });
  const headers = new Headers();
  headers.set("Content-Location", canonicalUrl);
  for (const name of ["content-type", "content-length", "etag", "last-modified", "cache-control"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
