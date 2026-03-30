import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/commons")({
  component: CommonsLayout,
});

function CommonsLayout() {
  return <Outlet />;
}
