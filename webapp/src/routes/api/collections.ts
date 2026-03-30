import { createFileRoute } from "@tanstack/react-router";
import { getCollections } from "@/lib/api-client";

export const Route = createFileRoute("/api/collections")({
  server: {
    handlers: {
      // GET /api/collections - Get all collections
      GET: async () => {
        const collections = await getCollections();
        return Response.json(collections);
      },
    },
  },
});

