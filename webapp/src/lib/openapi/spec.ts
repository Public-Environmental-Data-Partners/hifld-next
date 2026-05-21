import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

const LinkMap = z.record(z.string(), z.string()).openapi("ApiLinkMap");

const Problem = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number(),
    detail: z.string().optional(),
    instance: z.string().optional(),
    links: LinkMap.optional(),
  })
  .openapi("Problem");

const registry = new OpenAPIRegistry();

registry.registerPath({
  method: "get",
  path: "/api",
  summary: "API bootstrap and discovery",
  description:
    "Entry point with links to OpenAPI, /llms.txt, and collections. Call this first; do not assume OGC API-Features or STAC paths (/items, /features, ?q= on random segments).",
  responses: {
    200: {
      description: "Bootstrap JSON (title, description, links, hints)",
      content: {
        "application/json": {
          schema: z
            .object({
              title: z.string(),
              description: z.string(),
              links: LinkMap,
              hints: z.record(z.string(), z.string()).optional(),
            })
            .passthrough(),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/openapi",
  summary: "OpenAPI 3.1 document for this webapp surface",
  responses: {
    200: {
      description: "OpenAPI JSON",
      content: { "application/json": { schema: z.record(z.string(), z.unknown()) } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/health",
  summary: "Liveness / health",
  description: "Returns JSON suitable for RFC 9727 API catalog status links.",
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: z.object({ status: z.literal("ok") }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/collections",
  summary: "List collections",
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: z.array(
            z
              .object({
                id: z.number(),
                slug: z.string(),
                name: z.string(),
                links: z.object({ self: z.string() }).optional(),
              })
              .passthrough(),
          ),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/collections/{slug}",
  summary: "List datasets in a collection (paginated)",
  description:
    "This is the only collection-level list route: text search, tag filters, and pagination apply here (search, query, tag_filters, limit, offset, omit, include_urls). There is no /api/collections/{slug}/items, no ?q= shortcut on other paths, and no numeric dataset id in this URL—use dataset slug under .../datasets/{datasetSlug} next.",
  request: {
    query: z.object({
      query: z.string().optional().describe("Alias for text filter (same effect as search on this route)"),
      search: z.string().optional().describe("Filter datasets by text; use this or query, not q= on invented paths"),
      limit: z.coerce.number().int().positive().optional().describe("Defaults to 50 when omitted"),
      offset: z.coerce.number().int().nonnegative().optional(),
      include_urls: z.enum(["true", "false"]).optional(),
      tag_filters: z.string().optional().describe("Use GET .../datasets/tags to discover allowed values"),
      omit: z.string().optional().describe("Comma-separated; use 'description' to omit long descriptions"),
    }),
  },
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: z
            .object({
              collection: z.object({ id: z.number(), slug: z.string() }).passthrough(),
              datasets: z.array(z.object({ slug: z.string(), links: LinkMap.optional() }).passthrough()),
              total: z.number(),
              limit: z.number().nullable(),
              offset: z.number(),
              links: LinkMap.optional(),
            })
            .passthrough(),
        },
      },
    },
    400: { description: "Bad request", content: { "application/problem+json": { schema: Problem } } },
    404: { description: "Not found", content: { "application/problem+json": { schema: Problem } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/collections/{collectionSlug}/datasets/tags",
  summary: "Tag facets for filter discovery",
  request: {
    query: z.object({ tag_key: z.string().optional() }),
  },
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: z
            .object({
              links: LinkMap,
              tags: z.record(z.string(), z.array(z.string())),
            })
            .passthrough(),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/datasets",
  summary: "List datasets (capped aggregate across collections)",
  responses: {
    200: {
      description: "JSON array; each row may include links",
      content: {
        "application/json": {
          schema: z.array(z.object({ id: z.number(), slug: z.string(), links: LinkMap.optional() }).passthrough()),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/datasets/stats",
  responses: {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: z
            .object({
              total: z.number(),
              ready: z.number().optional(),
              links: LinkMap.optional(),
            })
            .passthrough(),
        },
      },
    },
  },
});

const generator = new OpenApiGeneratorV31(registry.definitions);

export function buildOpenApiDocument() {
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "HIFLD Next public webapp API",
      version: "1.0.0",
      description: [
        "TanStack webapp JSON routes that proxy dataset-api. Start with GET /api or GET /llms.txt, then GET /api/openapi for the full contract.",
        "Not OGC API-Features or STAC: no /items or /features collections; dataset URLs use string slugs (not /datasets/3418).",
        "Search and pagination: only on GET /api/collections/{slug} using search, query, tag_filters, limit, offset, omit (not ?q= on other paths).",
        "Collection dataset listing defaults to limit=50 when omitted (breaking vs older unbounded responses).",
        "GET /api/datasets returns at most 200 rows aggregated across collections.",
        "Unknown GET paths under /api respond with 404 and application/problem+json including links to /api, /api/openapi, and /llms.txt.",
      ].join(" "),
    },
  });
}
