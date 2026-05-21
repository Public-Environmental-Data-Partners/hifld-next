import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env/server";
import { getCollectionBySlug } from "@/lib/api-client";
import { jsonProblem } from "@/lib/api-problem";

const DOWNLOAD_TIMEOUT_MS = 300000;

interface DownloadZipParams {
  collectionSlug: string;
  datasetSlug: string;
  fileSlug: string;
  sourceId: string;
}

function datasetApiUnavailableDetail(): string {
  return `Check that the service is running at ${env.DATASET_API_URL}`;
}

function isConnectionFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("dns") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound")
  );
}

async function fetchZipFromDatasetApi(fastApiUrl: string, request: Request): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    return await fetch(fastApiUrl, {
      method: "GET",
      headers: {
        Accept: request.headers.get("Accept") || "application/zip",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function fetchZipErrorResponse(fetchError: Error): Response {
  if (fetchError.name === "AbortError") {
    return jsonProblem(504, "Request timeout", "The download took too long. Please try again.");
  }

  if (isConnectionFailure(fetchError.message)) {
    return jsonProblem(503, "Unable to connect to dataset API", datasetApiUnavailableDetail());
  }

  return jsonProblem(500, "Failed to connect to dataset API", fetchError.message);
}

async function readFailureDetail(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return response.text().catch(() => response.statusText);
  }

  const errorJson = (await response.json().catch(() => null)) as { detail?: string } | null;
  if (errorJson?.detail) {
    return String(errorJson.detail);
  }
  return errorJson ? JSON.stringify(errorJson) : response.statusText;
}

function zipFilename(contentDisposition: string, params: DownloadZipParams): string {
  const fallback = `${params.datasetSlug}_${params.fileSlug}_shapefile.zip`;
  const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
  return filenameMatch?.[1] ?? fallback;
}

async function forwardZipResponse(response: Response, params: DownloadZipParams): Promise<Response> {
  if (!response.ok) {
    return jsonProblem(response.status, "Failed to download zip", await readFailureDetail(response));
  }

  if (!response.body) {
    return jsonProblem(502, "Empty response from dataset API");
  }

  const contentDisposition =
    response.headers.get("Content-Disposition") ||
    `attachment; filename="${params.datasetSlug}_${params.fileSlug}_shapefile.zip"`;
  const filename = zipFilename(contentDisposition, params);

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export const Route = createFileRoute(
  "/api/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug/sources/$sourceId/download-zip",
)({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          if (!env.DATASET_API_URL) {
            return jsonProblem(500, "Server configuration error", "DATASET_API_URL is not configured");
          }

          const collection = await getCollectionBySlug({
            data: { slug: params.collectionSlug },
          });
          if (!collection) {
            return jsonProblem(404, "Collection not found");
          }

          const fastApiUrl = `${env.DATASET_API_URL}/api/collections/${collection.id}/datasets/by-slug/${params.datasetSlug}/files/${params.fileSlug}/sources/${params.sourceId}/download-zip`;

          let response: Response;
          try {
            response = await fetchZipFromDatasetApi(fastApiUrl, request);
          } catch (fetchError) {
            return fetchZipErrorResponse(fetchError instanceof Error ? fetchError : new Error(String(fetchError)));
          }

          return forwardZipResponse(response, params);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return jsonProblem(500, "Internal server error", msg);
        }
      },
    },
  },
});
