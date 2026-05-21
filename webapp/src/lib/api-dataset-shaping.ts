import type { DatasetWithUrls } from "@/lib/api-client";

/** Remove `description` from each dataset (catalog-style listing). */
export function omitDescriptionsFromDatasets(items: DatasetWithUrls[]): DatasetWithUrls[] {
  return items.map((d) => {
    const { description: _d, ...rest } = d;
    return rest as DatasetWithUrls;
  });
}
