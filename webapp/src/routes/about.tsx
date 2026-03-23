import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({
  component: AboutLayout,
});

function AboutLayout() {
  return <Outlet />;
}
