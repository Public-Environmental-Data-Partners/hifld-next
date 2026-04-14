import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import {
  getCollectionById,
  type Collection,
  type DatasetWithUrls,
} from "@/lib/api-client";
import { getDatasets } from "@/lib/datasets";
import {
  collectionSelf,
  datasetSelf,
  globalDatasetByIdSelf,
  globalDatasetsListSelf,
  requestOrigin,
} from "@/lib/api-links";
import { jsonProblem } from "@/lib/api-problem";

export const Route = createFileRoute("/api/datasets")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const search = url.searchParams.get("search") || undefined;
          const datasets = await getDatasets(search);
          const origin = requestOrigin(request);
          const colCache = new Map<number, Collection | null>();

          const resolveCol = async (cid: number | undefined) => {
            if (cid === undefined) return null;
            if (colCache.has(cid)) return colCache.get(cid) ?? null;
            const c = await getCollectionById({ data: { id: cid } });
            colCache.set(cid, c);
            return c;
          };

          const body: Array<DatasetWithUrls & { links: Record<string, string> }> =
            [];
          for (const d of datasets) {
            const col = await resolveCol(d.collection_id);
            const links: Record<string, string> = {
              self: col
                ? datasetSelf(origin, col.slug, d.slug, {
                    include_urls: true,
                  })
                : globalDatasetByIdSelf(origin, d.id),
            };
            if (col) {
              links.collection = collectionSelf(origin, col.slug);
            }
            body.push({ ...d, links });
          }

          const listSelf = globalDatasetsListSelf(origin, { search });
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              Link: `<${listSelf}>; rel="self"`,
            },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return jsonProblem(502, "Failed to list datasets", msg);
        }
      },

      POST: async () => {
        return json(
          { error: "Dataset creation is handled by dataset-api import script" },
          { status: 405 }
        );
      },
    },
  },
});
