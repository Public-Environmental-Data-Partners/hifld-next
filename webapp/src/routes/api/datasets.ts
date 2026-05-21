import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { type Collection, type DatasetWithUrls, getCollectionById } from "@/lib/api-client";
import {
  collectionSelf,
  datasetSelf,
  globalDatasetByIdSelf,
  globalDatasetsListSelf,
  requestOrigin,
} from "@/lib/api-links";
import { jsonProblem } from "@/lib/api-problem";
import { getDatasets } from "@/lib/datasets";

interface DatasetLinks {
  self: string;
  collection?: string;
}

export const Route = createFileRoute("/api/datasets")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const rawSearch = url.searchParams.get("search")?.trim();
          const search = rawSearch && rawSearch.length > 0 ? rawSearch : undefined;
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

          const body: Array<DatasetWithUrls & { links: DatasetLinks }> = [];
          for (const d of datasets) {
            const col = await resolveCol(d.collection_id);
            const links: DatasetLinks = {
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

          const listSelf = globalDatasetsListSelf(origin, search === undefined ? undefined : { search });
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
        return json({ error: "Dataset creation is handled by dataset-api import script" }, { status: 405 });
      },
    },
  },
});
