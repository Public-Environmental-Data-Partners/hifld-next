import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug"
)({
  component: FileLayout,
});

function FileLayout() {
  return <Outlet />;
}

