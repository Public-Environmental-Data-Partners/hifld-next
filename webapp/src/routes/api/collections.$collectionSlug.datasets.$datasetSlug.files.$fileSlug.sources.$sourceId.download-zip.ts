import { createFileRoute } from "@tanstack/react-router";
import { getCollectionBySlug } from "@/lib/api-client";
import { env } from "@/env/server";
import { jsonProblem } from "@/lib/api-problem";

export const Route = createFileRoute(
  "/api/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug/sources/$sourceId/download-zip"
)({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          if (!env.DATASET_API_URL) {
            return jsonProblem(
              500,
              "Server configuration error",
              "DATASET_API_URL is not configured"
            );
          }

          const collection = await getCollectionBySlug({
            data: { slug: params.collectionSlug },
          });
          if (!collection) {
            return jsonProblem(404, "Collection not found");
          }

          const fastApiUrl = `${env.DATASET_API_URL}/api/collections/${collection.id}/datasets/by-slug/${params.datasetSlug}/files/${params.fileSlug}/sources/${params.sourceId}/download-zip`;

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 300000);

          let response: Response;
          try {
            response = await fetch(fastApiUrl, {
              method: "GET",
              headers: {
                Accept: request.headers.get("Accept") || "application/zip",
              },
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
          } catch (fetchError) {
            clearTimeout(timeoutId);
            if (fetchError instanceof Error && fetchError.name === "AbortError") {
              return jsonProblem(
                504,
                "Request timeout",
                "The download took too long. Please try again."
              );
            }
            const msg =
              fetchError instanceof Error ? fetchError.message : String(fetchError);
            const lower = msg.toLowerCase();
            if (
              lower.includes("fetch failed") ||
              lower.includes("network") ||
              lower.includes("dns") ||
              lower.includes("econnrefused") ||
              lower.includes("enotfound")
            ) {
              return jsonProblem(
                503,
                "Unable to connect to dataset API",
                `Check that the service is running at ${env.DATASET_API_URL}`
              );
            }
            return jsonProblem(500, "Failed to connect to dataset API", msg);
          }

          if (!response.ok) {
            let detail = response.statusText;
            try {
              const contentType = response.headers.get("content-type") || "";
              if (contentType.includes("application/json")) {
                const errorJson = (await response.json().catch(() => null)) as {
                  detail?: string;
                } | null;
                if (errorJson?.detail) detail = String(errorJson.detail);
                else if (errorJson) detail = JSON.stringify(errorJson);
              } else {
                detail = await response.text().catch(() => response.statusText);
              }
            } catch {
              /* keep detail */
            }
            return jsonProblem(
              response.status,
              "Failed to download zip",
              detail
            );
          }

          if (!response.body) {
            return jsonProblem(502, "Empty response from dataset API");
          }

          const contentDisposition =
            response.headers.get("Content-Disposition") ||
            `attachment; filename="${params.datasetSlug}_${params.fileSlug}_shapefile.zip"`;
          const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
          const filename = filenameMatch
            ? filenameMatch[1]
            : `${params.datasetSlug}_${params.fileSlug}_shapefile.zip`;

          return new Response(response.body, {
            status: 200,
            headers: {
              "Content-Type": "application/zip",
              "Content-Disposition": `attachment; filename="${filename}"`,
            },
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return jsonProblem(500, "Internal server error", msg);
        }
      },
    },
  },
});
