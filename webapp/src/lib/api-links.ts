/**
 * Build absolute hypermedia URLs for public JSON API responses.
 */

export interface ApiLinkMap {
  first?: string | undefined;
  self?: string | undefined;
  prev?: string | undefined;
  next?: string | undefined;
  last?: string | undefined;
  [linkRelation: string]: string | undefined;
}

export function requestOrigin(request: Request): string {
  return new URL(request.url).origin;
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

export function collectionSelf(origin: string, collectionSlug: string): string {
  return `${origin}/api/collections/${enc(collectionSlug)}`;
}

export function collectionDatasetsTagsSelf(origin: string, collectionSlug: string, tagKey?: string): string {
  const u = new URL(`${origin}/api/collections/${enc(collectionSlug)}/datasets/tags`);
  if (tagKey) u.searchParams.set("tag_key", tagKey);
  return u.href;
}

export function collectionDatasetsListUrl(
  origin: string,
  collectionSlug: string,
  params: {
    query?: string | undefined;
    search?: string | undefined;
    include_urls?: boolean | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
    tag_filters?: string | undefined;
    omit?: string | undefined;
  },
): string {
  const u = new URL(`${origin}/api/collections/${enc(collectionSlug)}`);
  const q = params.query ?? params.search;
  if (q) u.searchParams.set("query", q);
  if (params.include_urls) u.searchParams.set("include_urls", "true");
  if (params.limit !== undefined) {
    u.searchParams.set("limit", String(params.limit));
  }
  if (params.offset !== undefined) u.searchParams.set("offset", String(params.offset));
  if (params.tag_filters) u.searchParams.set("tag_filters", params.tag_filters);
  if (params.omit) u.searchParams.set("omit", params.omit);
  return u.href;
}

export function datasetSelf(
  origin: string,
  collectionSlug: string,
  datasetSlug: string,
  opts?: { include_urls?: boolean },
): string {
  const u = new URL(`${origin}/api/collections/${enc(collectionSlug)}/datasets/${enc(datasetSlug)}`);
  if (opts?.include_urls) u.searchParams.set("include_urls", "true");
  return u.href;
}

export function fileSelf(origin: string, collectionSlug: string, datasetSlug: string, fileSlug: string): string {
  return `${origin}/api/collections/${enc(collectionSlug)}/datasets/${enc(datasetSlug)}/files/${enc(fileSlug)}`;
}

export function schemaSelf(
  origin: string,
  collectionSlug: string,
  datasetSlug: string,
  fileSlug: string,
  opts?: { version?: string | number | null | undefined },
): string {
  const u = new URL(
    `${origin}/api/collections/${enc(collectionSlug)}/datasets/${enc(datasetSlug)}/files/${enc(fileSlug)}/schema`,
  );
  if (opts?.version != null) u.searchParams.set("version", String(opts.version));
  return u.href;
}

export function schemaPath(
  collectionSlug: string,
  datasetSlug: string,
  fileSlug: string,
  opts?: { version?: string | number | null | undefined },
): string {
  const url = new URL(schemaSelf("https://local.invalid", collectionSlug, datasetSlug, fileSlug, opts));
  return `${url.pathname}${url.search}`;
}

export function sourceDownloadZip(
  origin: string,
  collectionSlug: string,
  datasetSlug: string,
  fileSlug: string,
  sourceId: number,
): string {
  return `${origin}/api/collections/${enc(collectionSlug)}/datasets/${enc(datasetSlug)}/files/${enc(fileSlug)}/sources/${sourceId}/download-zip`;
}

export function globalDatasetsListSelf(origin: string, opts?: { search?: string }): string {
  const u = new URL(`${origin}/api/datasets`);
  if (opts?.search) u.searchParams.set("search", opts.search);
  return u.href;
}

export function globalDatasetByIdSelf(origin: string, id: number): string {
  return `${origin}/api/datasets/${id}`;
}

export function globalDatasetStatsSelf(origin: string): string {
  return `${origin}/api/datasets/stats`;
}

export function openapiSpecSelf(origin: string): string {
  return `${origin}/api/openapi`;
}

export type PaginationNums = {
  total: number;
  limit: number;
  offset: number;
};

export type CollectionDatasetsLinkBase = Omit<Parameters<typeof collectionDatasetsListUrl>[2], "limit" | "offset">;

/**
 * Build first / prev / next / last URLs for collection+datasets listing.
 * Omits keys when not applicable. `limit` must be a positive finite number.
 */
export function collectionDatasetsPaginationLinks(
  origin: string,
  collectionSlug: string,
  baseParams: CollectionDatasetsLinkBase,
  page: PaginationNums,
): ApiLinkMap {
  const { total, limit, offset } = page;
  const links: ApiLinkMap = {};

  if (!Number.isFinite(limit) || limit <= 0) {
    return links;
  }

  links["first"] = collectionDatasetsListUrl(origin, collectionSlug, {
    ...baseParams,
    limit,
    offset: 0,
  });

  links["self"] = collectionDatasetsListUrl(origin, collectionSlug, {
    ...baseParams,
    limit,
    offset,
  });

  if (offset > 0) {
    links["prev"] = collectionDatasetsListUrl(origin, collectionSlug, {
      ...baseParams,
      limit,
      offset: Math.max(0, offset - limit),
    });
  }

  if (offset + limit < total) {
    links["next"] = collectionDatasetsListUrl(origin, collectionSlug, {
      ...baseParams,
      limit,
      offset: offset + limit,
    });
  }

  const lastOffset = total > 0 ? Math.floor((total - 1) / limit) * limit : 0;
  if (lastOffset !== offset || total === 0) {
    links["last"] = collectionDatasetsListUrl(origin, collectionSlug, {
      ...baseParams,
      limit,
      offset: lastOffset,
    });
  }

  return links;
}

/** RFC 8288 Link header value from pagination URLs. */
export function buildLinkHeader(links: ApiLinkMap): string | undefined {
  const parts: string[] = [];
  for (const rel of ["first", "prev", "next", "last"] as const) {
    const href = links[rel];
    if (href) parts.push(`<${href}>; rel="${rel}"`);
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}
