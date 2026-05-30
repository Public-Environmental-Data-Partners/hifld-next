import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { PageLoader } from "@/components/ui/page-loader";

export const Route = createFileRoute("/map")({
  component: MapRedirect,
});

function MapRedirect() {
  const navigate = useNavigate({ from: Route.fullPath });

  useEffect(() => {
    void navigate({
      to: "/collections/$collectionSlug/map",
      params: { collectionSlug: "hifld" },
      search: {},
      replace: true,
    });
  }, [navigate]);

  return (
    <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center">
      <PageLoader size="lg" />
    </div>
  );
}
