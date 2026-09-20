import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env/server";
import { requestOrigin } from "@/lib/api-links";

export const Route = createFileRoute("/stac/api")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const origin = requestOrigin(request, env.WEBAPP_PUBLIC_ORIGIN);
        const jsonResponse = {
          description: "STAC Catalog or API response",
          content: { "application/json": { schema: { type: "object" } } },
        };
        return new Response(
          JSON.stringify({
            openapi: "3.1.0",
            info: {
              title: "HIFLD Next STAC API",
              version: "1.0.0",
              description: "Read-only STAC API Core and Collections over published HIFLD Next version Collections.",
            },
            servers: [{ url: origin }],
            paths: {
              "/stac": { get: { summary: "STAC API landing page", responses: { "200": jsonResponse } } },
              "/stac/collections": {
                get: {
                  summary: "Page through version Collections",
                  parameters: [
                    {
                      in: "query",
                      name: "cursor",
                      required: false,
                      schema: { type: "string" },
                      description: "Opaque pagination cursor returned in a next link",
                    },
                  ],
                  responses: { "200": jsonResponse },
                },
              },
              "/stac/collections/{collectionId}": {
                get: {
                  summary: "Read a version Collection",
                  parameters: [
                    {
                      in: "path",
                      name: "collectionId",
                      required: true,
                      schema: { type: "string" },
                      description: "Percent-encoded full version path",
                    },
                  ],
                  responses: { "200": jsonResponse, "404": { description: "Collection not found" } },
                },
              },
            },
          }),
          { headers: { "Content-Type": "application/vnd.oai.openapi+json;version=3.1" } },
        );
      },
    },
  },
});
