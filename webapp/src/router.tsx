import { createRouter } from "@tanstack/react-router";

import { PageNotFound, RouteError } from "@/components/PageError";
import { trackUiFailure } from "@/lib/interaction-analytics";

// Import the generated route tree
import { routeTree } from "./routeTree.gen";

// Create a new router instance
export const getRouter = () => {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: PageNotFound,
    defaultOnCatch: () => trackUiFailure("application", "route_error"),
    defaultPreloadStaleTime: 0,
  });

  return router;
};
