import { createFileRoute } from "@tanstack/react-router";
import { serveStacCollections } from "./collections";
import { serveStacCollection } from "./collections.$collectionId";

export const Route = createFileRoute("/stac/collections/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        const id = params._splat ?? "";
        return id ? serveStacCollection(request, id) : serveStacCollections(request);
      },
    },
  },
});
