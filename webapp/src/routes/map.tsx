import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import { PageLoader } from "@/components/ui/page-loader";

const mapSearchSchema = z
  .object({
    query: z.string().optional(),
  })
  .catch({});

type MapSearch = z.infer<typeof mapSearchSchema>;
type CleanMapSearch = {
  query?: string;
};

function parseMapSearch(search: z.input<typeof mapSearchSchema>): MapSearch {
  return mapSearchSchema.parse(search);
}

function mapSearchForRedirect(search: MapSearch): CleanMapSearch {
  const next: CleanMapSearch = {};
  if (search.query !== undefined) next.query = search.query;
  return next;
}

export const Route = createFileRoute("/map")({
  validateSearch: parseMapSearch,
  component: MapRedirect,
});

function MapRedirect() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  useEffect(() => {
    void navigate({
      to: "/collections/$collectionSlug/map",
      params: { collectionSlug: "hifld" },
      search: mapSearchForRedirect(search),
      replace: true,
    });
  }, [navigate, search]);

  return (
    <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center">
      <PageLoader size="lg" />
    </div>
  );
}
