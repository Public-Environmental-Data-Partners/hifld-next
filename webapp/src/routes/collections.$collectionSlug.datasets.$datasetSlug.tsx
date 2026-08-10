import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout route only: the dataset detail page lives in the index route so that
// SEO metadata (canonical, JSON-LD) is emitted by exactly one matched route.
// A layout that also set head() would stamp the dataset's canonical/JSON-LD
// onto nested file pages, producing conflicting duplicates.
export const Route = createFileRoute("/collections/$collectionSlug/datasets/$datasetSlug")({
  component: DatasetLayout,
});

function DatasetLayout() {
  return <Outlet />;
}
