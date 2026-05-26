import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import { PageLoader } from "@/components/ui/page-loader";

const compareSearchSchema = z
  .object({
    left: z.string().optional(),
    right: z.string().optional(),
    mode: z.literal("metadata").optional(),
  })
  .catch({});

type CompareSearch = z.infer<typeof compareSearchSchema>;
type CleanCompareSearch = {
  left?: string;
  right?: string;
  mode?: "metadata";
};

function parseCompareSearch(search: z.input<typeof compareSearchSchema>): CompareSearch {
  return compareSearchSchema.parse(search);
}

function compareSearchForRedirect(search: CompareSearch): CleanCompareSearch {
  const next: CleanCompareSearch = {};
  if (search.left !== undefined) next.left = search.left;
  if (search.right !== undefined) next.right = search.right;
  if (search.mode !== undefined) next.mode = search.mode;
  return next;
}

export const Route = createFileRoute("/compare")({
  validateSearch: parseCompareSearch,
  component: CompareRedirect,
});

function CompareRedirect() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  useEffect(() => {
    void navigate({
      to: "/collections/$collectionSlug/compare",
      params: { collectionSlug: "hifld" },
      search: compareSearchForRedirect(search),
      replace: true,
    });
  }, [navigate, search]);

  return (
    <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center">
      <PageLoader size="lg" />
    </div>
  );
}
