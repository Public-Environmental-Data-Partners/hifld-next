/**
 * RFC 9727 API catalog as RFC 9264 Linkset (application/linkset+json).
 * @see https://www.rfc-editor.org/rfc/rfc9727
 */

export const RFC9727_LINKSET_PROFILE = "https://www.rfc-editor.org/info/rfc9727";

export const API_CATALOG_CONTENT_TYPE = `application/linkset+json; profile="${RFC9727_LINKSET_PROFILE}"`;

/** Bootstrap JSON + OpenAPI for the public webapp JSON API. */
export function buildApiCatalogLinkset(origin: string) {
  const apiBase = `${origin}/api`;
  return {
    linkset: [
      {
        anchor: apiBase,
        "service-desc": [
          {
            href: `${origin}/api/openapi`,
            type: "application/json",
          },
        ],
        "service-doc": [
          {
            href: `${origin}/llms.txt`,
            type: "text/markdown",
          },
          {
            href: `${origin}/about`,
            type: "text/html",
          },
        ],
        status: [
          {
            href: `${origin}/api/health`,
            type: "application/json",
          },
        ],
      },
    ],
  };
}
