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
  })
  .openapi("Problem");

const registry = new OpenAPIRegistry();

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
              .passthrough()
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
  request: {
    query: z.object({
      query: z.string().optional(),
      search: z.string().optional(),
      limit: z.coerce.number().int().positive().optional().describe("Defaults to 50 when omitted"),
      offset: z.coerce.number().int().nonnegative().optional(),
      include_urls: z.enum(["true", "false"]).optional(),
      tag_filters: z.string().optional(),
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
      description:
        "TanStack webapp JSON routes. Collection dataset listing defaults to limit=50 when omitted (breaking vs older unbounded responses). Global /api/datasets returns at most 200 rows aggregated from collection APIs.",
    },
  });
}
